import OpenAI from "openai";
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

export class OpenAIClient implements LlmProviderClient {
  readonly provider = "openai" as const;
  private readonly sdk: OpenAI;

  constructor(apiKey: string) {
    this.sdk = new OpenAI({ apiKey });
  }

  async complete(model: ModelSpec, req: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    try {
      const resp = await this.sdk.chat.completions.create({
        model: model.id,
        temperature: req.temperature ?? 0.3,
        max_tokens: req.maxTokens ?? 4096,
        response_format: req.jsonMode ? { type: "json_object" } : undefined,
        messages: req.messages.map(toOpenAIMessage),
        tools: req.tools?.map(toOpenAITool),
      });

      const choice = resp.choices[0];
      if (!choice) throw new Error("Empty response");

      const toolCalls = (choice.message.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeJson(tc.function.arguments),
      }));

      const usage = resp.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      const costUsd = computeCost(model, usage.prompt_tokens, usage.completion_tokens);

      return {
        content: choice.message.content ?? "",
        toolCalls,
        provider: "openai",
        model: model.id,
        usage: {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        },
        costUsd,
        latencyMs: Date.now() - started,
        finishReason: mapFinish(choice.finish_reason),
      };
    } catch (err) {
      throw new LlmProviderError("openai", err instanceof Error ? err.message : String(err));
    }
  }

  async *stream(model: ModelSpec, req: CompletionRequest): AsyncIterable<StreamChunk> {
    const started = Date.now();
    try {
      const resp = await this.sdk.chat.completions.create({
        model: model.id,
        temperature: req.temperature ?? 0.3,
        max_tokens: req.maxTokens ?? 4096,
        stream: true,
        stream_options: { include_usage: true },
        messages: req.messages.map(toOpenAIMessage),
        tools: req.tools?.map(toOpenAITool),
      });

      let fullText = "";
      const toolCallBuf = new Map<number, { id: string; name: string; args: string }>();
      let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      let finish: CompletionResult["finishReason"] = "stop";

      for await (const chunk of resp) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          fullText += delta.content;
          yield { type: "content", delta: delta.content };
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            const buf = toolCallBuf.get(idx) ?? { id: tc.id ?? "", name: "", args: "" };
            if (tc.id) buf.id = tc.id;
            if (tc.function?.name) buf.name = tc.function.name;
            if (tc.function?.arguments) {
              buf.args += tc.function.arguments;
              yield { type: "tool_call_delta", id: buf.id, name: buf.name, argsDelta: tc.function.arguments };
            }
            toolCallBuf.set(idx, buf);
          }
        }
        if (chunk.choices[0]?.finish_reason) finish = mapFinish(chunk.choices[0].finish_reason);
        if (chunk.usage) usage = chunk.usage;
      }

      const toolCalls = Array.from(toolCallBuf.values()).map((b) => ({
        id: b.id,
        name: b.name,
        arguments: safeJson(b.args),
      }));

      yield {
        type: "done",
        result: {
          content: fullText,
          toolCalls,
          provider: "openai",
          model: model.id,
          usage: {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          },
          costUsd: computeCost(model, usage.prompt_tokens, usage.completion_tokens),
          latencyMs: Date.now() - started,
          finishReason: finish,
        },
      };
    } catch (err) {
      throw new LlmProviderError("openai", err instanceof Error ? err.message : String(err));
    }
  }
}

function toOpenAIMessage(m: ChatMessage): OpenAI.Chat.ChatCompletionMessageParam {
  if (m.role === "tool") {
    return { role: "tool", content: m.content, tool_call_id: m.toolCallId! };
  }
  if (m.role === "assistant") {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.toolCalls?.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    };
  }
  return { role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam;
}

function toOpenAITool(t: ToolDefinition): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    },
  };
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapFinish(f: string | null | undefined): CompletionResult["finishReason"] {
  switch (f) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    case "content_filter":
      return "content_filter";
    default:
      return "stop";
  }
}

function computeCost(m: ModelSpec, inTok: number, outTok: number): number {
  return (inTok / 1_000_000) * m.inputCostPer1M + (outTok / 1_000_000) * m.outputCostPer1M;
}
