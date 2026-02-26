// Load an initialize this before any other code to start trace collection
import { extendedTracesMiddleware } from "inngest/experimental";
const extendedTraces = extendedTracesMiddleware();

import { Inngest, eventType, staticSchema } from "inngest";

import type { AgentMessageData, AgentReplyData } from "./channels/types.ts";

// Decentralized event types (replaces EventSchemas in v4)
export const agentMessageReceived = eventType("agent.message.received", {
  schema: staticSchema<AgentMessageData>(),
});

export const agentReplyReady = eventType("agent.reply.ready", {
  schema: staticSchema<AgentReplyData>(),
});

export const telegramUnsupported = eventType("telegram/message.unsupported", {
  schema: staticSchema<Record<string, unknown>>(),
});

export const telegramTransformFailed = eventType("telegram/transform.failed", {
  schema: staticSchema<{ error: string; raw: unknown }>(),
});

export const inngest = new Inngest({
  id: "ai-agent",
  checkpointing: true,
  middleware: [extendedTraces],
});
