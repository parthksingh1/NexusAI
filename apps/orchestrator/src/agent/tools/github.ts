import type { ToolDefinition } from "@nexusai/shared";
import { toolRegistry } from "../tool-registry.js";

const GITHUB = "https://api.github.com";

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "NexusAI",
    "x-github-api-version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

// ─── github_read_file ─────────────────────────────────────────
toolRegistry.register(
  {
    name: "github_read_file",
    description: "Read the raw contents of a file from a public (or authorized) GitHub repo.",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        path: { type: "string" },
        ref: { type: "string", description: "Branch/tag/sha (default: default branch)" },
      },
      required: ["owner", "repo", "path"],
    },
    risk: "safe",
  },
  async (input) => {
    const { owner, repo, path, ref } = input as Record<string, string>;
    const qs = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const r = await fetch(`${GITHUB}/repos/${owner}/${repo}/contents/${path}${qs}`, {
      headers: { ...headers(), accept: "application/vnd.github.raw" },
    });
    if (!r.ok) return { error: `github ${r.status}`, detail: await r.text() };
    return { path, contents: (await r.text()).slice(0, 100_000) };
  },
);

// ─── github_create_pr ─────────────────────────────────────────
toolRegistry.register(
  {
    name: "github_create_pr",
    description:
      "Create a branch, commit a set of file edits, and open a pull request. Requires GITHUB_TOKEN with repo scope.",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        base: { type: "string", description: "Base branch (e.g., main)" },
        headBranch: { type: "string", description: "New branch name to create" },
        title: { type: "string" },
        body: { type: "string" },
        files: {
          type: "array",
          description: "Array of { path, content } — content is UTF-8 text",
        },
      },
      required: ["owner", "repo", "base", "headBranch", "title", "files"],
    },
    risk: "dangerous",
    requiresApproval: true,
  },
  async (input) => {
    const { owner, repo, base, headBranch, title, body, files } = input as {
      owner: string; repo: string; base: string; headBranch: string;
      title: string; body?: string; files: Array<{ path: string; content: string }>;
    };

    const json = async (url: string, init?: RequestInit) => {
      const r = await fetch(`${GITHUB}${url}`, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) } });
      const text = await r.text();
      if (!r.ok) throw new Error(`${r.status} ${url}: ${text}`);
      return text ? JSON.parse(text) : {};
    };

    // 1. Get base branch head sha
    const baseRef = await json(`/repos/${owner}/${repo}/git/ref/heads/${base}`);
    const baseSha = baseRef.object.sha;

    // 2. Create new branch
    await json(`/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${headBranch}`, sha: baseSha }),
    });

    // 3. Get base tree
    const baseCommit = await json(`/repos/${owner}/${repo}/git/commits/${baseSha}`);
    const baseTreeSha = baseCommit.tree.sha;

    // 4. Create blobs + tree
    const blobs = await Promise.all(
      files.map(async (f) => {
        const b = await json(`/repos/${owner}/${repo}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({ content: f.content, encoding: "utf-8" }),
        });
        return { path: f.path, sha: b.sha, mode: "100644", type: "blob" };
      }),
    );
    const tree = await json(`/repos/${owner}/${repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTreeSha, tree: blobs }),
    });

    // 5. Create commit + move ref
    const commit = await json(`/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({ message: title, tree: tree.sha, parents: [baseSha] }),
    });
    await json(`/repos/${owner}/${repo}/git/refs/heads/${headBranch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });

    // 6. Open PR
    const pr = await json(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({ title, body: body ?? "", head: headBranch, base }),
    });
    return { prNumber: pr.number, url: pr.html_url, branch: headBranch };
  },
);
