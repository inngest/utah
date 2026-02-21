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
    let history = await step.run("load-history", async () => {
      return await buildConversationHistory(sessionKey);
    });

    // Compact if conversation is getting too long
    if (shouldCompact(history)) {
      history = await step.run("compact", async () => {
        return await runCompaction(history, sessionKey);
      });
    }

    // Build message array in pi-ai format
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

      // Think: call the LLM via pi-ai
      const llmResponse = await step.run("think", async () => {
        return await callLLM(systemPrompt, messagesForLLM, TOOLS);
      });

      // If the LLM returned an error, stop the loop
      if (llmResponse.stopReason === "error") {
        finalResponse = llmResponse.text || "(LLM returned an error)";
        done = true;
        break;
      }

      const toolCalls = llmResponse.toolCalls;

      if (toolCalls.length > 0) {
        // Add the full assistant content (text + tool calls) as returned by pi-ai
        messages.push({
          role: "assistant" as const,
          content: llmResponse.content,
        });

        // Act: execute each tool as a step
        for (const tc of toolCalls) {
          totalToolCalls++;

          const toolResult = await step.run(`tool-${tc.name}`, async () => {
            // Validate arguments using pi-ai's TypeBox validation
            const tool = TOOLS.find((t) => t.name === tc.name);
            if (tool) {
              validateToolArguments(tool, { name: tc.name, id: tc.id, arguments: tc.arguments });
            }
            return await executeTool(tc.name, tc.arguments);
          });

          // Observe: feed result back in pi-ai's toolResult format
          messages.push({
            role: "toolResult" as const,
            toolCallId: tc.id,
            toolName: tc.name,
            content: [{ type: "text" as const, text: toolResult.result }],
            isError: toolResult.error || false,
          } as any);
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
