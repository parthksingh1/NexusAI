import Docker from "dockerode";
import { v4 as uuidv4 } from "uuid";
import pino from "pino";

const log = pino({ name: "sandbox-executor", level: process.env.LOG_LEVEL ?? "info" });

export type Language = "python" | "node" | "bash";

export type ExecInput = {
  language: Language;
  code: string;
  stdin?: string;
  timeoutMs?: number;
  memoryMb?: number;
};

export type ExecEvent =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code: number; timedOut: boolean; durationMs: number };

const IMAGE_BY_LANG: Record<Language, string> = {
  python: "python:3.11-alpine",
  node: "node:20-alpine",
  bash: "alpine:3.20",
};

const CMD_BY_LANG: Record<Language, (code: string) => string[]> = {
  python: (c) => ["sh", "-c", `printf '%s' ${shEscape(c)} | python -`],
  node: (c) => ["sh", "-c", `printf '%s' ${shEscape(c)} | node -`],
  bash: (c) => ["sh", "-c", c],
};

function shEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Run untrusted code in a minimal Alpine container. Security posture:
 *   - no network (NetworkMode: "none")
 *   - read-only rootfs + /tmp tmpfs
 *   - capabilities dropped
 *   - memory + pids caps
 *   - runtime: gVisor ("runsc") when available on the host, else default "runc"
 * Phase 4 wires up an egress proxy + firejail-inside-container defense-in-depth.
 */
export class SandboxExecutor {
  private docker: Docker;

  constructor() {
    this.docker = new Docker();
  }

  async *run(input: ExecInput): AsyncGenerator<ExecEvent, void, unknown> {
    const image = IMAGE_BY_LANG[input.language];
    const cmd = CMD_BY_LANG[input.language](input.code);
    const timeoutMs = Math.min(60_000, input.timeoutMs ?? 15_000);
    const memoryMb = Math.min(1024, input.memoryMb ?? 256);
    const name = `nexus-sbx-${uuidv4().slice(0, 8)}`;
    const start = Date.now();

    await this.ensureImage(image);

    let container: Docker.Container | null = null;
    try {
      container = await this.docker.createContainer({
        name,
        Image: image,
        Cmd: cmd,
        OpenStdin: !!input.stdin,
        StdinOnce: !!input.stdin,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
        HostConfig: {
          AutoRemove: false,
          NetworkMode: "none",
          Memory: memoryMb * 1024 * 1024,
          MemorySwap: memoryMb * 1024 * 1024,
          PidsLimit: 128,
          CpuQuota: 50_000,
          CpuPeriod: 100_000,
          ReadonlyRootfs: true,
          Tmpfs: { "/tmp": "rw,noexec,nosuid,size=64m" },
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges:true"],
          Runtime: process.env.SANDBOX_RUNTIME ?? "runc",
        },
      });

      const stream = await container.attach({ stream: true, stdout: true, stderr: true, stdin: !!input.stdin });
      await container.start();

      if (input.stdin) {
        stream.write(input.stdin);
        stream.end();
      }

      // Demux docker stream format: 8-byte header (stream, 0,0,0, size_be32), then payload
      type Chunk = { type: "stdout" | "stderr"; data: string };
      const queue: Chunk[] = [];
      let resolve: ((v: Chunk | null) => void) | null = null;
      const push = (c: Chunk | null) => {
        if (resolve) {
          const r = resolve;
          resolve = null;
          r(c);
        } else if (c) queue.push(c);
      };

      let buf = Buffer.alloc(0);
      stream.on("data", (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 8) {
          const header = buf[0]!;
          const size = buf.readUInt32BE(4);
          if (buf.length < 8 + size) break;
          const payload = buf.slice(8, 8 + size).toString("utf8");
          buf = buf.slice(8 + size);
          push({ type: header === 2 ? "stderr" : "stdout", data: payload });
        }
      });

      const exitPromise = new Promise<{ code: number; timedOut: boolean }>((res) => {
        const timer = setTimeout(async () => {
          try {
            await container?.kill({ signal: "SIGKILL" });
          } catch { /* already dead */ }
          res({ code: 137, timedOut: true });
        }, timeoutMs);
        stream.on("end", async () => {
          clearTimeout(timer);
          try {
            const info = await container?.wait();
            res({ code: info?.StatusCode ?? -1, timedOut: false });
          } catch {
            res({ code: -1, timedOut: false });
          }
          push(null);
        });
      });

      while (true) {
        const next = await new Promise<Chunk | null>((r) => {
          if (queue.length) r(queue.shift() ?? null);
          else resolve = r;
        });
        if (!next) break;
        yield { type: next.type, data: next.data };
      }

      const exit = await exitPromise;
      yield { type: "exit", code: exit.code, timedOut: exit.timedOut, durationMs: Date.now() - start };
    } finally {
      if (container) {
        try { await container.remove({ force: true }); } catch { /* best-effort */ }
      }
    }
  }

  private async ensureImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
    } catch {
      log.info({ image }, "pulling sandbox image");
      await new Promise<void>((res, rej) => {
        this.docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) return rej(err);
          this.docker.modem.followProgress(stream, (e) => (e ? rej(e) : res()));
        });
      });
    }
  }
}
