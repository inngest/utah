/**
 * Telegram Typing Indicator — shows "typing..." immediately when a message arrives.
 *
 * Triggers on the same event as the message handler but runs independently.
 * Best-effort: no retries, failures are swallowed.
 */

import { inngest } from "../../client.ts";
import { sendTyping } from "./api.ts";

export const telegramTyping = inngest.createFunction(
  { id: "telegram-typing-indicator", retries: 0 },
  { event: "agent.message.received", if: 'event.data.channel == "telegram"' },
  async ({ event, step }) => {
    const { chatId } = event.data as { chatId: string };
    if (!chatId) return;

    await step.run("send-typing", async () => {
      await sendTyping(chatId);
    });
  },
);
