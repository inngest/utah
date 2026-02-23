/**
 * Telegram channel handler — implements the ChannelHandler interface.
 */

import type { SendReplyParams, AcknowledgeParams } from "../types.ts";
import { sendMessage, sendTyping as apiSendTyping } from "./api.ts";
import { markdownToTelegramHTML, stripMarkdown, splitMessage } from "./format.ts";

/**
 * Telegram-specific metadata passed through channelMeta.
 */
interface TelegramMeta {
  chatType?: "private" | "group" | "supergroup" | "channel";
  chatTitle?: string;
  replyToMessage?: {
    messageId: number;
    text?: string;
  };
  forumTopicId?: number;
}

/**
 * Send an agent reply to Telegram. Handles HTML conversion,
 * message splitting, and plain text fallback.
 */
export async function sendReply({ response, destination, channelMeta }: SendReplyParams): Promise<void> {
  const { chatId, messageId } = destination;

  // Send typing first
  await apiSendTyping(chatId);

  const chunks = splitMessage(response);

  for (let i = 0; i < chunks.length; i++) {
    try {
      await sendMessage(chatId, markdownToTelegramHTML(chunks[i]), {
        parseMode: "HTML",
      });
    } catch (err: any) {
      // Fallback to plain text if HTML parsing fails
      if (err.message?.includes("can't parse entities")) {
        await sendMessage(chatId, stripMarkdown(chunks[i]));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Acknowledge message receipt — Telegram shows a typing indicator.
 */
export async function acknowledge({ destination }: AcknowledgeParams): Promise<void> {
  await apiSendTyping(destination.chatId);
}

/**
 * Run Telegram-specific setup (webhooks).
 */
export { setupTelegram as setup } from "./setup.ts";
