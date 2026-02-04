import Anthropic from "@anthropic-ai/sdk";
import type { ToolDefinition } from "@nexusai/shared";
import { LlmProviderError } from "@nexusai/shared";
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  LlmProviderClient,
  ModelSpec,
  StreamChunk,
} from "../types.js";

export class AnthropicClient implements LlmProviderClient {
  readonly provider = "anthropic" as const;
  private readonly sdk: Anthropic;

  constructor(apiKey: string) {
    this.sdk = new Anthropic({ apiKey });
  }

  async complete(model: ModelSpec, req: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    const { system, messages } = splitSystem(req.messages);

    try {
      const response = await this.sdk.messages.create({
        model: model.id,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.3,
        system,
        messages: messages.map(toAnthropicMessage),
        tools: req.tools?.map(toAnthropicTool),
      });

      const content = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      const toolCalls = response.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((b) => ({
          id: b.id,
          name: b.name,
          arguments: (b.input as Record<string, unknown>) ?? {},
        }));

      const costUsd = computeCost(model, response.usage.input_tokens, response.usage.output_tokens);

      return {
        content,
        toolCalls,
        provider: "anthropic",
        model: model.id,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
        costUsd,
        latencyMs: Date.now() - started,
        finishReason: mapStop(response.stop_reason),
      };
    } catch (err) {
      throw new LlmProviderError("anthropic", err instanceof Error ? err.message : String(err));
    }
  }

  async *stream(model: ModelSpec, req: CompletionRequest): AsyncIterable<StreamChunk> {
    const started = Date.now();
    const { system, messages } = splitSystem(req.messages);
    let inputTokens = 0;
    let outputTokens = 0;
    let fullText = "";
    const toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];
    let currentToolArgs = "";
    let currentToolId = "";
    let currentToolName = "";

    try {
      const streamResp = this.sdk.messages.stream({
        model: model.id,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.3,
        system,
        messages: messages.map(toAnthropicMessage),
        tools: req.tools?.map(toAnthropicTool),
      });

      for await (const event of streamResp) {
        if (event.type === "content_block_start") {
          if (event.content_block.type === "tool_use") {
            currentToolId = event.content_block.id;
            currentToolName = event.content_block.name;
            currentToolArgs = "";
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            fullText += event.delta.text;
            yield { type: "content", delta: event.delta.text };
          } else if (event.delta.type === "input_json_delta") {
            currentToolArgs += event.delta.partial_json;
            yield { type: "tool_call_delta", id: currentToolId, name: currentToolName, argsDelta: event.delta.partial_json };
          }
        } else if (event.type === "content_block_stop" && currentToolId) {
          try {
            toolCalls.push({ id: currentToolId, name: currentToolName, arguments: JSON.parse(currentToolArgs || "{}") });
          } catch {
            toolCalls.push({ id: currentToolId, name: currentToolName, arguments: {} });
          }
          currentToolId = "";
          currentToolName = "";
          currentToolArgs = "";
        } else if (event.type === "message_delta") {
          if (event.usage) outputTokens = event.usage.output_tokens;
        } else if (event.type === "message_start") {
          inputTokens = event.message.usage.input_tokens;
        }
      }

      const final = await streamResp.finalMessage();
      const costUsd = computeCost(model, inputTokens || final.usage.input_tokens, outputTokens || final.usage.output_tokens);

      yield {
        type: "done",
        result: {
          content: fullText,
          toolCalls,
          provider: "anthropic",
          model: model.id,
          usage: {
            promptTokens: inputTokens || final.usage.input_tokens,
            completionTokens: outputTokens || final.usage.output_tokens,
            totalTokens: (inputTokens || final.usage.input_tokens) + (outputTokens || final.usage.output_tokens),
          },
          costUsd,
          latencyMs: Date.now() - started,
          finishReason: mapStop(final.stop_reason),
        },
      };
    } catch (err) {
      throw new LlmProviderError("anthropic", err instanceof Error ? err.message : String(err));
    }
  }
}

// ─── helpers ────────────────────────────────────────────────────
function splitSystem(messages: ChatMessage[]): { system?: string; messages: ChatMessage[] } {
  const systems = messages.filter((m) => m.role === "system").map((m) => m.content);
  const rest = messages.filter((m) => m.role !== "system");
  return { system: systems.length ? systems.join("\n\n") : undefined, messages: rest };
}

function toAnthropicMessage(m: ChatMessage): Anthropic.MessageParam {
  if (m.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: m.toolCallId!,
          content: m.content,
        },
      ],
    };
  }
  if (m.role === "assistant" && m.toolCalls?.length) {
    const blocks: any[] = [];
    if (m.content) blocks.push({ type: "text", text: m.content });
    for (const tc of m.toolCalls) {
      blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
    }
    return { role: "assistant", content: blocks };
  }
  return { role: m.role === "assistant" ? "assistant" : "user", content: m.content };
}

function toAnthropicTool(t: ToolDefinition): Anthropic.Tool {
  return {
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
  };
}

function mapStop(stop: string | null): CompletionResult["finishReason"] {
  switch (stop) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return "stop";
  }
}

function computeCost(m: ModelSpec, inTok: number, outTok: number): number {
  return (inTok / 1_000_000) * m.inputCostPer1M + (outTok / 1_000_000) * m.outputCostPer1M;
}
