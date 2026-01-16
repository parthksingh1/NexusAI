import type { ToolDefinition } from "@nexusai/shared";
import { ToolExecutionError } from "@nexusai/shared";

export type ToolContext = {
  agentId: string;
  runId: string;
  ownerId: string;
};

export type ToolHandler = (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;

export type RegisteredTool = {
  definition: ToolDefinition;
  handler: ToolHandler;
};

class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(def: ToolDefinition, handler: ToolHandler): void {
    if (this.tools.has(def.name)) {
      throw new Error(`Tool already registered: ${def.name}`);
    }
    this.tools.set(def.name, { definition: def, handler });
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(names?: string[]): ToolDefinition[] {
    const all = [...this.tools.values()].map((t) => t.definition);
    if (!names) return all;
    return all.filter((d) => names.includes(d.name));
  }

  async invoke(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new ToolExecutionError(name, "Tool not found");
    try {
      return await tool.handler(input, ctx);
    } catch (err) {
      throw new ToolExecutionError(name, err instanceof Error ? err.message : String(err));
    }
  }
}

export const toolRegistry = new ToolRegistry();
