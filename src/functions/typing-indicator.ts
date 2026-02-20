/**
 * Typing Indicator — generic Inngest function that dispatches to the correct channel.
 *
 * Listens for agent.message.received events and shows a typing/activity
 * indicator on the appropriate channel. Best-effort: no retries.
 */

import { inngest } from "../client.ts";
import { getChannel } from "../channels/index.ts";

export const typingIndicator = inngest.createFunction(
  { id: "typing-indicator", retries: 0 },
  { event: "agent.message.received" },
  async ({ event, step }) => {
    const { channel, chatId } = event.data as {
      channel: string;
      chatId: string;
    };

    if (!chatId) return;

    const handler = getChannel(channel);
    if (!handler) return; // Silently skip unknown channels

    await step.run("send-typing", async () => {
      await handler.sendTyping({ chatId });
    });
  },
);
