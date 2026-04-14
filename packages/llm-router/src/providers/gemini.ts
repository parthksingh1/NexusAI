import { GoogleGenerativeAI, SchemaType, type Content, type FunctionDeclaration, type Tool } from "@google/generative-ai";
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

export class GeminiClient implements LlmProviderClient {
  readonly provider = "gemini" as const;
  private readonly sdk: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.sdk = new GoogleGenerativeAI(apiKey);
  }

  async complete(model: ModelSpec, req: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    try {
      const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const history = req.messages.filter((m) => m.role !== "system").map(toGeminiContent);

      const generative = this.sdk.getGenerativeModel({
        model: model.id,
        systemInstruction: system || undefined,
        tools: req.tools ? [{ functionDeclarations: req.tools.map(toGeminiTool) }] : undefined,
        generationConfig: {
          temperature: req.temperature ?? 0.3,
          maxOutputTokens: req.maxTokens ?? 4096,
          responseMimeType: req.jsonMode ? "application/json" : undefined,
        },
      });

      const result = await generative.generateContent({ contents: history });
      const response = result.response;
      const text = response.text();

      const toolCalls = (response.functionCalls() ?? []).map((fc, i) => ({
        id: `gem_tc_${i}_${Date.now()}`,
        name: fc.name,
        arguments: (fc.args as Record<string, unknown>) ?? {},
      }));

      const usage = response.usageMetadata ?? { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
      const costUsd = computeCost(model, usage.promptTokenCount, usage.candidatesTokenCount);

      return {
        content: text,
        toolCalls,
        provider: "gemini",
        model: model.id,
        usage: {
          promptTokens: usage.promptTokenCount,
          completionTokens: usage.candidatesTokenCount,
          totalTokens: usage.totalTokenCount,
        },
        costUsd,
        latencyMs: Date.now() - started,
        finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      };
    } catch (err) {
      throw new LlmProviderError("gemini", err instanceof Error ? err.message : String(err));
    }
  }

  async *stream(model: ModelSpec, req: CompletionRequest): AsyncIterable<StreamChunk> {
    const started = Date.now();
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const history = req.messages.filter((m) => m.role !== "system").map(toGeminiContent);

    const generative = this.sdk.getGenerativeModel({
      model: model.id,
      systemInstruction: system || undefined,
      tools: req.tools ? [{ functionDeclarations: req.tools.map(toGeminiTool) }] : undefined,
      generationConfig: {
        temperature: req.temperature ?? 0.3,
        maxOutputTokens: req.maxTokens ?? 4096,
      },
    });

    try {
      const result = await generative.generateContentStream({ contents: history });
      let fullText = "";
      const toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];
      let usage = { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          fullText += text;
          yield { type: "content", delta: text };
        }
        const fcs = chunk.functionCalls();
        if (fcs) {
          for (const fc of fcs) {
            toolCalls.push({
              id: `gem_tc_${toolCalls.length}_${Date.now()}`,
              name: fc.name,
              arguments: (fc.args as Record<string, unknown>) ?? {},
            });
          }
        }
        if (chunk.usageMetadata) usage = chunk.usageMetadata;
      }

      const final = await result.response;
      if (final.usageMetadata) usage = final.usageMetadata;

      yield {
        type: "done",
        result: {
          content: fullText,
          toolCalls,
          provider: "gemini",
          model: model.id,
          usage: {
            promptTokens: usage.promptTokenCount,
            completionTokens: usage.candidatesTokenCount,
            totalTokens: usage.totalTokenCount,
          },
          costUsd: computeCost(model, usage.promptTokenCount, usage.candidatesTokenCount),
          latencyMs: Date.now() - started,
          finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
        },
      };
    } catch (err) {
      throw new LlmProviderError("gemini", err instanceof Error ? err.message : String(err));
    }
  }
}

function toGeminiContent(m: ChatMessage): Content {
  if (m.role === "tool") {
    return {
      role: "function",
      parts: [{ functionResponse: { name: m.name ?? "tool", response: { result: m.content } } }],
    };
  }
  if (m.role === "assistant" && m.toolCalls?.length) {
    return {
      role: "model",
      parts: [
        ...(m.content ? [{ text: m.content }] : []),
        ...m.toolCalls.map((tc) => ({ functionCall: { name: tc.name, args: tc.arguments } })),
      ],
    };
  }
  return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] };
}

function toGeminiTool(t: ToolDefinition): FunctionDeclaration {
  type PropSpec = { type: string; description?: string; enum?: string[] };
  const entries = Object.entries(t.parameters.properties) as Array<[string, PropSpec]>;
  return {
    name: t.name,
    description: t.description,
    parameters: {
      type: SchemaType.OBJECT,
      properties: Object.fromEntries(
        entries.map(([k, v]) => [
          k,
          { type: mapType(v.type), description: v.description, enum: v.enum },
        ]),
      ),
      required: t.parameters.required,
    },
  } as FunctionDeclaration;
}

function mapType(t: string): SchemaType {
  switch (t) {
    case "string": return SchemaType.STRING;
    case "number": return SchemaType.NUMBER;
    case "integer": return SchemaType.INTEGER;
    case "boolean": return SchemaType.BOOLEAN;
    case "array": return SchemaType.ARRAY;
    case "object": return SchemaType.OBJECT;
    default: return SchemaType.STRING;
  }
}

function computeCost(m: ModelSpec, inTok: number, outTok: number): number {
  return (inTok / 1_000_000) * m.inputCostPer1M + (outTok / 1_000_000) * m.outputCostPer1M;
}

export { GeminiClient as _GeminiClient };
// unused export kept out; _ prefix avoided — unused Tool import suppression
void (null as unknown as Tool);
