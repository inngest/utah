/**
 * LLM — wrapper around pi-ai's complete() function.
 *
 * pi-ai provides a unified interface for multiple LLM providers
 * (Anthropic, OpenAI, Google) with TypeBox-based tool validation.
 */

import { getModel, complete, validateToolArguments } from "@mariozechner/pi-ai";
import type { Tool, Message } from "@mariozechner/pi-ai";
import { config } from "../config.ts";

export type { Tool, Message };
export { validateToolArguments };

let _model: ReturnType<typeof getModel> | null = null;

export function getConfiguredModel() {
  if (!_model) {
    _model = getModel(config.llm.provider, config.llm.model);
  }
  return _model;
}

export interface LLMResponse {
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  content: any[];
  usage?: { input?: number; output?: number; cost?: { total?: number } };
  stopReason?: string;
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
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("");

  const toolCalls = result.content
    .filter((c: any) => c.type === "toolCall")
    .map((c: any) => ({
      id: c.id,
      name: c.name,
      arguments: c.arguments || {},
    }));

  return {
    text,
    toolCalls,
    content: result.content,
    usage: result.usage,
    stopReason: result.stopReason,
  };
}
