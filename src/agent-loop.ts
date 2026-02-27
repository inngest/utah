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
import { TOOLS, SUB_AGENT_TOOLS, executeTool, type ToolResult } from "./lib/tools.ts";
import { buildSystemPrompt, buildConversationHistory } from "./lib/context.ts";
import { ensureWorkspace } from "./lib/memory.ts";
import { shouldCompact, runCompaction } from "./lib/compaction.ts";
import type { SessionMessage } from "./lib/session.ts";
import type { GetStepTools } from "inngest";
import type { inngest } from "./client.ts";

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

type StepAPI = GetStepTools<typeof inngest>;
type ToolStepInput = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export interface AgentLoopOptions {
  /** Tools available in this loop. Defaults to TOOLS (includes delegate_task). */
  tools?: typeof TOOLS;
  /** Whether this is a sub-agent (disables delegate_task handling). */
  isSubAgent?: boolean;
}

/**
 * Create the agent loop for a given message and session.
 * Returns a function that takes an Inngest step API and runs the loop.
 */
export function createAgentLoop(userMessage: string, sessionKey: string, options?: AgentLoopOptions) {
  return async (step: StepAPI): Promise<AgentRunResult> => {
    const tools = options?.tools ?? TOOLS;

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
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            stopReason: "stop" as const,
            timestamp: Date.now(),
          };
        }
        return {
          role: "user" as const,
          content: h.content,
          timestamp: Date.now(),
        };
      }),
      { role: "user" as const, content: userMessage, timestamp: Date.now() },
    ];

    let iterations = 0;
    let totalToolCalls = 0;
    let finalResponse = "";
    let done = false;
    let hasCompactedThisRun = false;

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
        ? [
            ...messages,
            {
              role: "user" as const,
              content: budgetWarning,
              timestamp: Date.now(),
            },
          ]
        : messages;

      // Think: call the LLM via pi-ai
      const llmResponse = await step.run(
        "think",
        async ({ systemPrompt: sp }: { systemPrompt: string }) => {
          return await callLLM(sp, messagesForLLM, tools);
        },
        { systemPrompt },
      );

      // If the LLM returned an error, check if it's a context overflow
      if (llmResponse.stopReason === "error") {
        const errMsg =
          llmResponse.message.errorMessage ||
          llmResponse.text ||
          "Unknown LLM error";
        const isOverflow =
          /context.?overflow|prompt.?too.?large|too many tokens|maximum context|token limit/i.test(
            errMsg,
          );

        if (isOverflow && !hasCompactedThisRun) {
          // Context overflow — force-compact the conversation and retry this iteration
          console.log(`[loop] Context overflow detected, force-compacting...`);
          hasCompactedThisRun = true;

          // Aggressive pruning: keep only the last few messages
          const keepCount = Math.min(6, messages.length);
          const toSummarize = messages.slice(0, messages.length - keepCount);
          const toKeep = messages.slice(-keepCount);

          if (toSummarize.length > 0) {
            const summaryText = toSummarize
              .map((m) => {
                const role = (m as any).role?.toUpperCase() || "UNKNOWN";
                const text =
                  typeof (m as any).content === "string"
                    ? (m as any).content
                    : "[complex content]";
                return `${role}: ${typeof text === "string" ? text.slice(0, 200) : ""}`;
              })
              .join("\n");

            messages.length = 0;
            messages.push({
              role: "user" as const,
              content: `[Previous conversation was too long and has been summarized]\n\n${summaryText.slice(0, 2000)}`,
              timestamp: Date.now(),
            });
            messages.push(...toKeep);
          }

          // Don't increment iterations for the overflow recovery
          iterations--;
          continue;
        }

        // Non-overflow error — throw so Inngest retries
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

          let toolResult: ToolResult;

          if (tc.name === "delegate_task" && !options?.isSubAgent) {
            // delegate_task uses step.invoke() to spawn a sub-agent function
            const subSessionKey = `sub-${sessionKey}-${Date.now()}`;
            const { subAgent } = await import("./functions/sub-agent.ts");
            const subResult = await step.invoke("sub-agent", {
              function: subAgent,
              data: {
                task: tc.arguments.task as string,
                subSessionKey,
                parentSessionKey: sessionKey,
              },
            });
            toolResult = {
              result: subResult?.response || "(Sub-agent returned no response)",
            };
          } else {
            toolResult = await step.run(
              `tool-${tc.name}`,
              async ({ name, id, args }: ToolStepInput) => {
                // Validate arguments using pi-ai's TypeBox validation
                const tool = tools.find((t) => t.name === name);
                if (tool) {
                  validateToolArguments(tool, {
                    type: "toolCall",
                    name,
                    id,
                    arguments: args,
                  });
                }
                return await executeTool(id, name, args);
              },
              { name: tc.name, id: tc.id, args: tc.arguments },
            );
          }

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
          `[loop] iter=${iterations} tools=${toolCalls.length} tokens=${llmResponse.usage.input || "?"}in/${llmResponse.usage.output || "?"}out cost=$${llmResponse.usage.cost?.total?.toFixed(4) || "?"}`,
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
