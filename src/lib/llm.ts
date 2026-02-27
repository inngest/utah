/**
 * LLM — wrapper around pi-ai's complete() function.
 *
 * pi-ai provides a unified interface for multiple LLM providers
 * (Anthropic, OpenAI, Google) with TypeBox-based tool validation.
 */

import { getModel, complete, validateToolArguments } from "@mariozechner/pi-ai";
import type { Tool, Message, AssistantMessage, KnownProvider } from "@mariozechner/pi-ai";
import { config } from "../config.ts";

export type { Tool, Message, AssistantMessage };
export { validateToolArguments };

let _model: ReturnType<typeof getModel> | null = null;

export function getConfiguredModel() {
  if (!_model) {
    // Provider and model come from runtime config (env vars).
    // getModel's generics require literal types from the MODELS registry,
    // so we assert here — an invalid combo will throw at runtime.
    _model = getModel(
      config.llm.provider as KnownProvider as any,
      config.llm.model as any,
    );
    if (!_model) {
      throw new Error(
        `Unknown model "${config.llm.model}" for provider "${config.llm.provider}". Check AGENT_MODEL and LLM_PROVIDER env vars.`,
      );
    }
  }
  return _model;
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
}

export async function callLLM(
  system: string,
  messages: Message[],
  tools: Tool[],
): Promise<LLMResponse> {
  const model = getConfiguredModel();

  const result = await complete(model, {
    systemPrompt: system,
    messages,
    tools,
  });

  const text = result.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("");

  const toolCalls = result.content
    .filter((c) => c.type === "toolCall")
    .map((c) => {
      const tc = c as { type: "toolCall"; id: string; name: string; arguments: Record<string, any> };
      return { id: tc.id, name: tc.name, arguments: tc.arguments || {} };
    });

  return {
    message: result,
    text,
    toolCalls,
    usage: result.usage,
    stopReason: result.stopReason,
  };
}
