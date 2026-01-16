import type { ToolDefinition } from "@nexusai/shared";
import { toolRegistry } from "../tool-registry.js";

const SANDBOX_URL = process.env.SANDBOX_URL ?? "http://localhost:4100";

const definition: ToolDefinition = {
  name: "code_exec",
  description:
    "Execute code in a sandboxed container (python | node | bash). No network access. 15s default timeout. Use for data analysis, one-off calculations, and verifying code snippets.",
  parameters: {
    type: "object",
    properties: {
      language: { type: "string", enum: ["python", "node", "bash"] },
      code: { type: "string", description: "Source code to execute" },
      stdin: { type: "string", description: "Optional stdin" },
      timeoutMs: { type: "number", description: "Timeout in ms (max 60000)" },
    },
    required: ["language", "code"],
  },
  risk: "moderate",
  requiresApproval: false,
};

async function codeExec(input: Record<string, unknown>): Promise<unknown> {
  const r = await fetch(`${SANDBOX_URL}/exec`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    return { error: `sandbox ${r.status}`, detail: await r.text() };
  }
  return await r.json();
}

toolRegistry.register(definition, codeExec);
