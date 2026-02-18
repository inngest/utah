/**
 * LLM — thin wrapper around the Anthropic Messages API.
 * No SDK dependency. Just fetch.
 */

import { config } from "../config.ts";

export interface LLMToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface LLMResponse {
  text: string;
  toolCalls: LLMToolCall[];
}

interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export async function callAnthropic(
  system: string,
  messages: Array<{ role: string; content: unknown }>,
  tools: Tool[],
): Promise<LLMResponse> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.llm.anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.agent.model,
      max_tokens: config.llm.maxTokens,
      system,
      messages,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    content: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
    }>;
  };

  return {
    text: data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text || "")
      .join(""),
    toolCalls: data.content
      .filter((b) => b.type === "tool_use")
      .map((b) => ({
        id: b.id || crypto.randomUUID(),
        name: b.name || "",
        input: b.input || {},
      })),
  };
}
