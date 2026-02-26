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
 */

import { inngest, agentMessageReceived } from "../client.ts";
import { createAgentLoop } from "../agent-loop.ts";
import { appendToSession } from "../lib/session.ts";

export const handleMessage = inngest.createFunction(
  {
    id: "agent-handle-message",
    retries: 2,
    triggers: [agentMessageReceived],
    concurrency: [{ scope: "fn", key: "event.data.sessionKey", limit: 1 }],
    cancelOn: [
      {
        event: "agent.message.received",
        match: "data.sessionKey",
        if: "async.data.destination.messageId != event.data.destination.messageId",
      },
    ],
  },
  async ({ event, step }) => {
    const {
      message,
      sessionKey = "main",
      channel = "unknown",
      destination,
      channelMeta = {},
    } = event.data;

    // Save the incoming message
    await step.run("save-incoming", async () => {
      await appendToSession(sessionKey, "user", message);
    });

    // Run the agent loop — each think/tool is a durable step
    const agentLoop = createAgentLoop(message, sessionKey);
    const result = await agentLoop(step);

    // Save the response
    await step.run("save-response", async () => {
      await appendToSession(sessionKey, "assistant", result.response, {
        iterations: result.iterations,
        toolCalls: result.toolCalls,
      });
    });

    // Emit a reply event — destination and channelMeta pass through
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
