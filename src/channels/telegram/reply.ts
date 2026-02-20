/**
 * Telegram Reply — Inngest function that sends agent responses to Telegram.
 *
 * Listens for agent.reply.ready events on the "telegram" channel.
 * Converts markdown to Telegram HTML, splits long messages,
 * and falls back to plain text if HTML parsing fails.
 */

import { inngest } from "../../client.ts";
import { sendMessage, sendTyping } from "./api.ts";
import { markdownToTelegramHTML, stripMarkdown, splitMessage } from "./format.ts";

export const telegramReply = inngest.createFunction(
  { id: "telegram-send-reply", retries: 3 },
  { event: "agent.reply.ready", if: 'event.data.channel == "telegram"' },
  async ({ event, step }) => {
    const { response, chatId, messageId } = event.data as {
      response: string;
      chatId: string;
      messageId?: string;
    };

    // Send typing indicator
    await step.run("typing", async () => {
      await sendTyping(chatId);
    });

    // Split long messages (Telegram limit: 4096 chars)
    const chunks = splitMessage(response);

    for (let i = 0; i < chunks.length; i++) {
      await step.run(`send-chunk-${i}`, async () => {
        const replyTo = i === 0 && messageId ? parseInt(messageId) : undefined;

        try {
          return await sendMessage(chatId, markdownToTelegramHTML(chunks[i]), {
            parseMode: "HTML",
            replyToMessageId: replyTo,
          });
        } catch (err: any) {
          // Fallback to plain text if HTML parsing fails
          if (err.message?.includes("can't parse entities")) {
            return await sendMessage(chatId, stripMarkdown(chunks[i]), {
              replyToMessageId: replyTo,
            });
          }
          throw err;
        }
      });
    }
  },
);
