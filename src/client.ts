import { EventSchemas, Inngest } from "inngest";
import { extendedTracesMiddleware } from "inngest/experimental";
import type { AgentMessageData, AgentReplyData } from "./channels/types.ts";

type Events = {
  "agent.message.received": {
    data: AgentMessageData;
  };
  "agent.reply.ready": {
    data: AgentReplyData;
  };
  "telegram/message.unsupported": {
    data: Record<string, unknown>;
  };
  "telegram/transform.failed": {
    data: { error: string; raw: unknown };
  };
};

export const inngest = new Inngest({
  id: "ai-agent",
  checkpointing: true,
  middleware: [extendedTracesMiddleware()],
  schemas: new EventSchemas().fromRecord<Events>(),
});
