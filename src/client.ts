import { EventSchemas, Inngest } from "inngest";
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
  "agent.subagent.spawn": {
    data: {
      task: string;
      subSessionKey: string;
      parentSessionKey: string;
    };
  };
};

export const inngest = new Inngest({
  id: "ai-agent",
  checkpointing: true,
  schemas: new EventSchemas().fromRecord<Events>(),
});
