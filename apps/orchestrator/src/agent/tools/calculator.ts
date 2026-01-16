import type { ToolDefinition } from "@nexusai/shared";
import { toolRegistry } from "../tool-registry.js";

const definition: ToolDefinition = {
  name: "calculator",
  description: "Evaluate arithmetic expressions. Supports +, -, *, /, %, **, parentheses.",
  parameters: {
    type: "object",
    properties: {
      expression: { type: "string", description: "Arithmetic expression, e.g. '(3 + 5) * 2'" },
    },
    required: ["expression"],
  },
  risk: "safe",
};

/**
 * Safe arithmetic evaluator — refuses anything that isn't numbers and operators.
 * Intentionally avoids eval(); a tiny shunting-yard would be nicer but regex is sufficient here.
 */
function calc(input: Record<string, unknown>): Promise<unknown> {
  const expr = String(input.expression ?? "");
  if (!/^[\d+\-*/().%\s*]+$/.test(expr)) {
    return Promise.resolve({ error: "Expression contains disallowed characters" });
  }
  try {
    // eslint-disable-next-line no-new-func
    const value = Function(`"use strict"; return (${expr});`)();
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return Promise.resolve({ error: "Result is not a finite number" });
    }
    return Promise.resolve({ expression: expr, result: value });
  } catch (err) {
    return Promise.resolve({ error: err instanceof Error ? err.message : "eval failed" });
  }
}

toolRegistry.register(definition, calc);
