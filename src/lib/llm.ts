/**
 * LLM — wrapper around pi-ai's complete() function.
 *
 * pi-ai provides a unified interface for multiple LLM providers
 * (Anthropic, OpenAI, Google) with TypeBox-based tool validation.
 */

import { getModel, complete, validateToolArguments } from "@mariozechner/pi-ai";
import type {
  Tool,
  Message,
  AssistantMessage,
  TextContent,
  ToolCall,
  KnownProvider,
  Model,
  Api,
} from "@mariozechner/pi-ai";
import { config } from "../config.ts";

export type { Tool, Message, AssistantMessage, TextContent, ToolCall };
export { validateToolArguments };

// getModel's generics require literal types from the MODELS registry.
// Since provider/model come from env vars at runtime, we use a loosened
// signature that still constrains the provider to KnownProvider.
const getModelByName = getModel as (provider: KnownProvider, modelId: string) => Model<Api>;

let _model: Model<Api> | null = null;
let _fallbackModel: Model<Api> | null = null;

export function getConfiguredModel() {
  if (!_model) {
    _model = getModelByName(config.llm.provider, config.llm.model);
    if (!_model) {
      throw new Error(
        `Unknown model "${config.llm.model}" for provider "${config.llm.provider}". Check AGENT_MODEL and LLM_PROVIDER env vars.`,
      );
    }
  }
  return _model;
}

export function getFallbackModel(): Model<Api> | null {
  if (!config.llm.fallbackProvider || !config.llm.fallbackModel) return null;
  if (!_fallbackModel) {
    _fallbackModel = getModelByName(config.llm.fallbackProvider, config.llm.fallbackModel);
    if (!_fallbackModel) {
      throw new Error(
        `Unknown fallback model "${config.llm.fallbackModel}" for provider "${config.llm.fallbackProvider}". Check FALLBACK_AGENT_MODEL and FALLBACK_LLM_PROVIDER env vars.`,
      );
    }
  }
  return _fallbackModel;
}

export interface LLMResponse {
  /** The full AssistantMessage from pi-ai — push this directly into the message array */
  message: AssistantMessage;
  /** Extracted text content for convenience */
  text: string;
  /** Extracted tool calls for convenience */
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  usage: AssistantMessage["usage"];
  stopReason: AssistantMessage["stopReason"];
  /** Which model served this response ("provider/model") */
  model: string;
}

export async function callLLM(
  system: string,
  messages: Message[],
  tools: Tool[],
  options?: { useFallback?: boolean },
): Promise<LLMResponse> {
  const fallback = options?.useFallback ? getFallbackModel() : null;
  const model = fallback ?? getConfiguredModel();
  const provider = fallback ? config.llm.fallbackProvider! : config.llm.provider;
  const modelName = fallback ? config.llm.fallbackModel! : config.llm.model;

  const result = await complete(model, {
    systemPrompt: system,
    messages,
    tools,
  });

  const text = result.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");

  const toolCalls = result.content
    .filter((c): c is ToolCall => c.type === "toolCall")
    .map((c) => ({ id: c.id, name: c.name, arguments: c.arguments || {} }));

  return {
    message: result,
    text,
    toolCalls,
    usage: result.usage,
    stopReason: result.stopReason,
    model: `${provider}/${modelName}`,
  };
}
