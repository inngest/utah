/**
 * Telegram channel handler — implements the ChannelHandler interface.
 */

import type { SendReplyParams, AcknowledgeParams } from "../types.ts";
import { sendMessage, sendTyping as apiSendTyping } from "./api.ts";
import { markdownToTelegramHTML, stripMarkdown, splitMessage } from "./format.ts";

/**
 * Send an agent reply to Telegram. Handles HTML conversion,
 * message splitting, and plain text fallback.
 */
export async function sendReply({ response, chatId, messageId }: SendReplyParams): Promise<void> {
  // Send typing first
  await apiSendTyping(chatId);

  const chunks = splitMessage(response);

  for (let i = 0; i < chunks.length; i++) {
    const replyTo = i === 0 && messageId ? parseInt(messageId) : undefined;

    try {
      await sendMessage(chatId, markdownToTelegramHTML(chunks[i]), {
        parseMode: "HTML",
        replyToMessageId: replyTo,
      });
    } catch (err: any) {
      // Fallback to plain text if HTML parsing fails
      if (err.message?.includes("can't parse entities")) {
        await sendMessage(chatId, stripMarkdown(chunks[i]), {
          replyToMessageId: replyTo,
        });
      } else {
        throw err;
      }
    }
  }
}

/**
 * Acknowledge message receipt — Telegram shows a typing indicator.
 */
export async function acknowledge({ chatId }: AcknowledgeParams): Promise<void> {
  await apiSendTyping(chatId);
}

/**
 * Run Telegram-specific setup (webhooks).
 */
export { setupTelegram as setup } from "./setup.ts";
