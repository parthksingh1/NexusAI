import type { ToolDefinition } from "@nexusai/shared";
import { SafetyViolationError } from "@nexusai/shared";
import { prisma } from "@nexusai/db";
import { redis } from "../redis.js";
import { logger } from "../logger.js";

/**
 * Tool risk scoring + human-in-the-loop approval queue.
 * Flow:
 *   1. Before executing a tool, score risk (from definition + heuristics)
 *   2. If risk >= "dangerous" OR requiresApproval, create ApprovalRequest row
 *   3. Orchestrator blocks via Redis subscription on `approvals:<requestId>`
 *   4. UI / reviewer calls POST /approvals/:id/decide → publishes to channel
 */

const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\//i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,   // fork bomb
  /drop\s+table/i,
  /drop\s+database/i,
  /eval\s*\(.*process\.env/i,
];

export type RiskAssessment = {
  score: number;                  // 0..1
  level: "safe" | "moderate" | "dangerous";
  blocked: boolean;
  reasons: string[];
};

export function assessRisk(def: ToolDefinition, input: Record<string, unknown>): RiskAssessment {
  const reasons: string[] = [];
  let score = def.risk === "dangerous" ? 0.8 : def.risk === "moderate" ? 0.4 : 0.1;

  const serialized = JSON.stringify(input);
  for (const p of BLOCKED_PATTERNS) {
    if (p.test(serialized)) {
      reasons.push(`matched blocked pattern: ${p.source.slice(0, 40)}`);
      score = 1.0;
    }
  }
  if (/api[_-]?key|password|secret|token/i.test(serialized) && /set|assign|=/.test(serialized)) {
    reasons.push("possible secret exfiltration");
    score = Math.max(score, 0.9);
  }

  return {
    score,
    level: score >= 0.7 ? "dangerous" : score >= 0.35 ? "moderate" : "safe",
    blocked: score >= 0.99,
    reasons,
  };
}

/**
 * Await human approval. Returns true if approved, false if rejected or timed out.
 */
export async function awaitApproval(
  runId: string,
  tool: string,
  input: Record<string, unknown>,
  risk: RiskAssessment,
  timeoutMs = 120_000,
): Promise<boolean> {
  if (risk.blocked) throw new SafetyViolationError("tool input matches blocked pattern", { reasons: risk.reasons });

  const req = await prisma.approvalRequest.create({
    data: {
      runId,
      tool,
      input: input as any,
      riskLevel: risk.level,
      status: "PENDING",
    },
  });

  logger.warn({ runId, tool, risk }, "awaiting human approval");

  const channel = `approvals:${req.id}`;
  return new Promise<boolean>((resolve) => {
    const sub = redis.duplicate();
    let settled = false;
    const finish = async (approved: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await sub.unsubscribe(channel).catch(() => {});
      await sub.quit().catch(() => {});
      resolve(approved);
    };
    const timer = setTimeout(async () => {
      await prisma.approvalRequest.updateMany({ where: { id: req.id, status: "PENDING" }, data: { status: "EXPIRED" } });
      await finish(false);
    }, timeoutMs);

    sub.subscribe(channel).then(() => {
      sub.on("message", async (_ch, msg) => {
        await finish(msg === "approved");
      });
    });
  });
}
