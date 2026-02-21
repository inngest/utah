/**
 * Message Handler — the main agent function.
 *
 * Trigger: agent.message.received
 * Flow: load session → run agent loop → save result → emit reply event
 *
 * Key Inngest features used:
 * - Singleton concurrency (one run per chat at a time)
 * - cancelOn (new message cancels active run)
 * - Step-based execution (each LLM call and tool is a step)
 *
 * All step.* calls happen at the top level of this function —
 * the agent loop returns a plain result, it does NOT call step.* internally.
 * This avoids Inngest's "nested step" detection issues.
 */

import { inngest } from "../client.ts";
import { config } from "../config.ts";
import { callLLM, validateToolArguments, type Message } from "../lib/llm.ts";
import { TOOLS, executeTool } from "../lib/tools.ts";
import { buildSystemPrompt, buildConversationHistory } from "../lib/context.ts";
import { ensureWorkspace } from "../lib/memory.ts";
import { shouldCompact, runCompaction } from "../lib/compaction.ts";
import { appendToSession } from "../lib/session.ts";

// --- Context Pruning ---

const PRUNING = {
  keepLastAssistantTurns: 3,
  softTrim: { maxChars: 4000, headChars: 1500, tailChars: 1500 },
  hardClear: { threshold: 50_000, placeholder: "[Tool result cleared — old context]" },
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

// --- The Function ---

export const handleMessage = inngest.createFunction(
  {
    id: "agent-handle-message",
    retries: 2,
    concurrency: [{ scope: "fn", key: "event.data.destination.chatId", limit: 1 }],
    cancelOn: [{ event: "agent.message.received", match: "data.destination.chatId" }],
  },
  { event: "agent.message.received" },
  async ({ event, step }) => {
    const {
      message,
      sessionKey = "main",
      channel = "unknown",
      destination,
      channelMeta = {},
    } = event.data;

    // Ensure workspace directories exist
    await step.run("ensure-workspace", async () => {
      await ensureWorkspace();
    });

    // Save the incoming message
    await step.run("save-incoming", async () => {
      await appendToSession(sessionKey, "user", message);
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

    // Build message array
    const messages: Message[] = [
      ...history.map((h: { role: string; content: string }) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      })),
      { role: "user" as const, content: message },
    ];

    // --- Agent Loop (all step.* calls at top level) ---

    let iterations = 0;
    let totalToolCalls = 0;
    let finalResponse = "";
    let done = false;

    while (!done && iterations < config.loop.maxIterations) {
      iterations++;

      // Prune old tool results
      if (iterations > PRUNING.keepLastAssistantTurns) {
        pruneOldToolResults(messages);
      }

      // Budget warnings
      const budgetWarning =
        iterations >= config.loop.maxIterations - 3
          ? `\n\n[SYSTEM: You are on iteration ${iterations} of ${config.loop.maxIterations}. You MUST respond with your final answer NOW.]`
          : iterations >= config.loop.maxIterations - 10
            ? `\n\n[SYSTEM: Iteration ${iterations}/${config.loop.maxIterations}. Start wrapping up.]`
            : "";

      const messagesForLLM = budgetWarning
        ? [...messages, { role: "user" as const, content: budgetWarning }]
        : messages;

      // Think: call the LLM
      const llmResponse = await step.run("think", async () => {
        return await callLLM(systemPrompt, messagesForLLM, TOOLS);
      });

      const toolCalls = llmResponse.toolCalls;

      if (toolCalls.length > 0) {
        // Add assistant content (text + tool calls)
        messages.push({
          role: "assistant" as const,
          content: llmResponse.content,
        });

        // Act: execute each tool
        for (const tc of toolCalls) {
          totalToolCalls++;

          const toolResult = await step.run(`tool-${tc.name}`, async () => {
            const tool = TOOLS.find((t) => t.name === tc.name);
            if (tool) {
              validateToolArguments(tool, { name: tc.name, id: tc.id, arguments: tc.arguments });
            }
            return await executeTool(tc.name, tc.arguments);
          });

          // Observe: feed result back
          messages.push({
            role: "toolResult" as const,
            toolCallId: tc.id,
            toolName: tc.name,
            content: [{ type: "text" as const, text: toolResult.result }],
            isError: toolResult.error || false,
          } as any);
        }
      } else if (llmResponse.text) {
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

    const result = {
      response: finalResponse,
      iterations,
      toolCalls: totalToolCalls,
      model: `${config.llm.provider}/${config.llm.model}`,
    };

    // Save the response
    await step.run("save-response", async () => {
      await appendToSession(sessionKey, "assistant", result.response, {
        iterations: result.iterations,
        toolCalls: result.toolCalls,
      });
    });

    // Emit reply event — destination and channelMeta pass through
    if (destination) {
      await step.sendEvent("reply", {
        name: "agent.reply.ready",
        data: {
          response: result.response,
          channel,
          destination,
          channelMeta,
        },
      });
    }

    return result;
  },
);
