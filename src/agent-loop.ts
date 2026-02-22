/**
 * Agent Loop — the core think → act → observe cycle, powered by pi-ai.
 *
 * Each iteration:
 * 1. Call the LLM via pi-ai's complete() with conversation history + tools
 * 2. If the LLM wants tools, validate args with pi-ai and execute as Inngest steps
 * 3. Feed results back into the conversation
 * 4. Repeat until the LLM responds with text (no tools) or max iterations
 *
 * Every LLM call and tool execution is an Inngest step —
 * giving you durability, retries, and observability for free.
 *
 * pi-ai differences from raw Anthropic API:
 * - Unified Message/Tool types that work across providers
 * - TypeBox schemas for tool parameters (validated at runtime)
 * - Content blocks use "toolCall" / "toolResult" instead of "tool_use" / "tool_result"
 */

import { config } from "./config.ts";
import { callLLM, validateToolArguments, type Message } from "./lib/llm.ts";
import { TOOLS, executeTool } from "./lib/tools.ts";
import { buildSystemPrompt, buildConversationHistory } from "./lib/context.ts";
import { ensureWorkspace } from "./lib/memory.ts";
import { shouldCompact, runCompaction } from "./lib/compaction.ts";
import type { SessionMessage } from "./lib/session.ts";

// --- Types ---

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
 *
 * pi-ai uses "toolResult" content blocks with a content array,
 * different from Anthropic's raw "tool_result" format.
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
    const msg = messages[i] as any;
    if (msg.role !== "toolResult") continue;
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        totalToolChars += block.text.length;
      }
    }
  }

  const useHardClear = totalToolChars > PRUNING.hardClear.threshold;

  for (let i = 0; i < pruneUpTo; i++) {
    const msg = messages[i] as any;
    if (msg.role !== "toolResult") continue;
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        if (useHardClear) {
          block.text = PRUNING.hardClear.placeholder;
        } else if (block.text.length > PRUNING.softTrim.maxChars) {
          const head = block.text.slice(0, PRUNING.softTrim.headChars);
          const tail = block.text.slice(-PRUNING.softTrim.tailChars);
          block.text = `${head}\n\n... [${block.text.length - PRUNING.softTrim.headChars - PRUNING.softTrim.tailChars} chars trimmed] ...\n\n${tail}`;
        }
      }
    }
  }
}

// --- The Loop ---

/**
 * Minimal step interface for the agent loop.
 * Compatible with Inngest's step API — we only use run() here.
 * sendEvent is called directly by the function handler, not the loop.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StepAPI = {
  run: (id: string, fn: () => Promise<any>) => Promise<any>;
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

    // Load conversation history (step.run returns Jsonified types, so we annotate)
    let history: SessionMessage[] = await step.run("load-history", async () => {
      return await buildConversationHistory(sessionKey);
    });

    // Compact if conversation is getting too long
    if (shouldCompact(history)) {
      history = await step.run("compact", async () => {
        return await runCompaction(history, sessionKey);
      });
    }

    // Build message array in pi-ai format.
    // History entries are simplified {role, content} strings from our session log.
    // pi-ai's transformMessages() expects AssistantMessage.content to be an array
    // of content blocks (it calls .flatMap on it), so we must convert accordingly.
    const messages: Message[] = [
      ...history.map((h): Message => {
        if (h.role === "assistant") {
          // Construct a minimal AssistantMessage with content as block array
          return {
            role: "assistant" as const,
            content: [{ type: "text" as const, text: h.content }],
            // These fields are required by AssistantMessage but unknown for history entries.
            // transformMessages checks provider/api/model to decide if it's the "same model" —
            // empty strings ensure it takes the cross-model path (safe, strips signatures).
            api: "" as any,
            provider: "",
            model: "",
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: "stop" as const,
            timestamp: Date.now(),
          };
        }
        return { role: "user" as const, content: h.content, timestamp: Date.now() };
      }),
      { role: "user" as const, content: userMessage, timestamp: Date.now() },
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
        ? [...messages, { role: "user" as const, content: budgetWarning, timestamp: Date.now() }]
        : messages;

      // Think: call the LLM via pi-ai
      const llmResponse = await step.run("think", async () => {
        return await callLLM(systemPrompt, messagesForLLM, TOOLS);
      });

      // If the LLM returned an error, throw so Inngest retries the step
      if (llmResponse.stopReason === "error") {
        const errMsg = llmResponse.message.errorMessage || llmResponse.text || "Unknown LLM error";
        throw new Error(`LLM error: ${errMsg}`);
      }

      const toolCalls = llmResponse.toolCalls;

      if (toolCalls.length > 0) {
        // Push the full AssistantMessage from pi-ai (includes provider, api, model,
        // stopReason, usage, timestamp) — required by transformMessages() on next iteration
        messages.push(llmResponse.message);

        // Act: execute each tool as a step
        for (const tc of toolCalls) {
          totalToolCalls++;

          const toolResult = await step.run(`tool-${tc.name}`, async () => {
            // Validate arguments using pi-ai's TypeBox validation
            const tool = TOOLS.find((t) => t.name === tc.name);
            if (tool) {
              validateToolArguments(tool, { type: "toolCall", name: tc.name, id: tc.id, arguments: tc.arguments });
            }
            return await executeTool(tc.name, tc.arguments);
          });

          // Observe: feed result back in pi-ai's ToolResultMessage format
          messages.push({
            role: "toolResult" as const,
            toolCallId: tc.id,
            toolName: tc.name,
            content: [{ type: "text" as const, text: toolResult.result }],
            isError: toolResult.error || false,
            timestamp: Date.now(),
          });
        }
      } else if (llmResponse.text) {
        // No tools — text response IS the reply
        finalResponse = llmResponse.text;
        done = true;
      }

      // Log iteration
      if (llmResponse.usage) {
        console.log(
          `[loop] iter=${iterations} tools=${toolCalls.length} tokens=${llmResponse.usage.input || "?"}in/${llmResponse.usage.output || "?"}out cost=$${llmResponse.usage.cost?.total?.toFixed(4) || "?"}`
        );
      }
    }

    if (!done) {
      finalResponse = `(Reached max iterations: ${config.loop.maxIterations})`;
    }

    return {
      response: finalResponse,
      iterations,
      toolCalls: totalToolCalls,
      model: `${config.llm.provider}/${config.llm.model}`,
    };
  };
}
