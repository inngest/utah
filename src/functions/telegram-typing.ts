/**
 * Typing Indicator — shows "typing..." immediately when a message arrives.
 *
 * Triggers on the same event as the message handler but runs independently.
 * Best-effort: no retries, failures are swallowed.
 */

import { inngest } from "../client.ts";
import { config } from "../config.ts";

export const telegramTyping = inngest.createFunction(
  { id: "telegram-typing-indicator", retries: 0 },
  { event: "agent.message.received", if: 'event.data.channel == "telegram"' },
  async ({ event, step }) => {
    const { chatId } = event.data as { chatId: string };
    const botToken = config.telegram.botToken;
    if (!botToken || !chatId) return;

    await step.run("send-typing", async () => {
      await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, action: "typing" }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    });
  },
);
