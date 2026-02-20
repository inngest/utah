/**
 * Agent Loop — the core think → act → observe cycle.
 *
 * Each iteration:
 * 1. Call the LLM with conversation history + tools
 * 2. If the LLM wants tools, execute them as Inngest steps
 * 3. Feed results back into the conversation
 * 4. Repeat until the LLM responds with text (no tools) or max iterations
 *
 * Every LLM call and tool execution is an Inngest step —
 * giving you durability, retries, and observability for free.
 */

import { config } from "./config.ts";
import { callAnthropic, type LLMToolCall } from "./lib/llm.ts";
import { TOOLS, executeTool } from "./lib/tools.ts";
import { buildSystemPrompt, buildConversationHistory } from "./lib/context.ts";
import { ensureWorkspace } from "./lib/memory.ts";

// --- Types ---

interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
}

export interface AgentRunResult {
  response: string;
  iterations: number;
  toolCalls: number;
  model: string;
}

// --- Context Pruning ---

/**
 * Two-tier pruning inspired by OpenClaw/pi-agent-core:
 * - Soft trim: keep head + tail of old tool results
 * - Hard clear: replace entirely when total context is huge
 */
const PRUNING = {
  keepLastAssistantTurns: 3,
  softTrim: {
    maxChars: 4000,
    headChars: 1500,
    tailChars: 1500,
  },
  hardClear: {
    threshold: 50_000,
    placeholder: "[Tool result cleared — old context]",
  },
} as const;

function pruneOldToolResults(messages: Message[]) {
  const recentCount = PRUNING.keepLastAssistantTurns * 2;
  const pruneUpTo = Math.max(0, messages.length - recentCount);

  let totalToolChars = 0;
  for (let i = 0; i < pruneUpTo; i++) {
    const msg = messages[i];
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === "tool_result" && typeof block.content === "string") {
        totalToolChars += block.content.length;
      }
    }
  }

  const useHardClear = totalToolChars > PRUNING.hardClear.threshold;

  for (let i = 0; i < pruneUpTo; i++) {
    const msg = messages[i];
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === "tool_result" && typeof block.content === "string") {
        if (useHardClear) {
          block.content = PRUNING.hardClear.placeholder;
        } else if (block.content.length > PRUNING.softTrim.maxChars) {
          const head = block.content.slice(0, PRUNING.softTrim.headChars);
          const tail = block.content.slice(-PRUNING.softTrim.tailChars);
          block.content = `${head}\n\n... [${block.content.length - PRUNING.softTrim.headChars - PRUNING.softTrim.tailChars} chars trimmed] ...\n\n${tail}`;
        }
      }
    }
  }
}

// --- The Loop ---

type StepAPI = {
  run: (id: string, fn: () => Promise<unknown>) => Promise<any>;
  sendEvent: (id: string, event: { name: string; data: unknown }) => Promise<void>;
};

/**
 * Create the agent loop for a given message and session.
 * Returns a function that takes an Inngest step API and runs the loop.
 */
export function createAgentLoop(userMessage: string, sessionKey: string) {
  return async (step: StepAPI): Promise<AgentRunResult> => {
    // Ensure workspace directories exist (sessions, memory)
    await step.run("ensure-workspace", async () => {
      await ensureWorkspace();
    });

    // Build system prompt (loads SOUL.md, USER.md, memory)
    const systemPrompt = await step.run("load-context", async () => {
      return await buildSystemPrompt();
    });

    // Load conversation history
    const history = await step.run("load-history", async () => {
      return await buildConversationHistory(sessionKey);
    });

    const messages: Message[] = [
      ...history.map((h: { role: string; content: string }) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      })),
      { role: "user" as const, content: userMessage },
    ];

    let iterations = 0;
    let totalToolCalls = 0;
    let finalResponse = "";
    let done = false;

    while (!done && iterations < config.loop.maxIterations) {
      iterations++;

      // Prune old tool results to keep context focused
      if (iterations > PRUNING.keepLastAssistantTurns) {
        pruneOldToolResults(messages);
      }

      // Budget warnings when running low on iterations
      const budgetWarning =
        iterations >= config.loop.maxIterations - 3
          ? `\n\n[SYSTEM: You are on iteration ${iterations} of ${config.loop.maxIterations}. You MUST respond with your final answer NOW. Do not call any more tools.]`
          : iterations >= config.loop.maxIterations - 10
            ? `\n\n[SYSTEM: Iteration ${iterations}/${config.loop.maxIterations}. Start wrapping up — respond with text soon.]`
            : "";

      const messagesForLLM = budgetWarning
        ? [...messages, { role: "user" as const, content: budgetWarning }]
        : messages;

      // Think: call the LLM
      const llmResponse = await step.run("think", async () => {
        return await callAnthropic(systemPrompt, messagesForLLM, TOOLS);
      });

      const toolCalls = llmResponse.toolCalls as LLMToolCall[];

      if (toolCalls.length > 0) {
        // Build assistant message with tool_use blocks
        const assistantContent: ContentBlock[] = [];
        if (llmResponse.text) {
          assistantContent.push({ type: "text", text: llmResponse.text });
        }
        for (const tc of toolCalls) {
          assistantContent.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.input,
          });
        }
        messages.push({ role: "assistant", content: assistantContent });

        // Act: execute each tool as a step
        const toolResults: ContentBlock[] = [];
        for (const tc of toolCalls) {
          totalToolCalls++;
          const result = await step.run(`tool-${tc.name}`, async () => {
            return await executeTool(tc.name, tc.input as Record<string, unknown>);
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: tc.id,
            content: result.result,
          });
        }

        // Observe: feed results back
        messages.push({ role: "user", content: toolResults });
      } else if (llmResponse.text) {
        // No tools — text response IS the reply
        finalResponse = llmResponse.text;
        done = true;
      }
    }

    if (!done) {
      finalResponse = `(Reached max iterations: ${config.loop.maxIterations})`;
    }

    return {
      response: finalResponse,
      iterations,
      toolCalls: totalToolCalls,
      model: config.agent.model,
    };
  };
}
