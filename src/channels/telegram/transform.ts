/**
 * Inngest Webhook Transform: Telegram → agent.message.received
 *
 * This is the source of truth for the transform function that runs
 * inside Inngest Cloud. The setup script syncs this to the webhook
 * configuration automatically on startup.
 *
 * The transform must be plain JavaScript (no TypeScript, no imports)
 * since it executes in Inngest's sandboxed transform runtime.
 */

// Plain JS transform — synced to Inngest webhook by setup script
export const TRANSFORM_SOURCE = `function transform(evt, headers, queryParams) {
  try {
    if (!evt.message || !evt.message.text) {
      return { name: "telegram/message.unsupported", data: evt };
    }

    var msg = evt.message;
    var chatId = String(msg.chat.id);
    var fromId = String(msg.from && msg.from.id || "unknown");
    var firstName = (msg.from && msg.from.first_name) || "Unknown";
    var lastName = msg.from && msg.from.last_name;
    var username = msg.from && msg.from.username;
    var displayName = lastName ? firstName + " " + lastName : firstName;

    return {
      name: "agent.message.received",
      data: {
        message: msg.text,
        sessionKey: "telegram-" + chatId,
        channel: "telegram",
        sender: {
          id: fromId,
          name: displayName,
          username: username
        },
        destination: {
          chatId: chatId,
          messageId: String(msg.message_id),
          threadId: msg.message_thread_id ? String(msg.message_thread_id) : undefined
        },
        channelMeta: {
          chatType: msg.chat.type,
          chatTitle: msg.chat.title,
          replyToMessage: msg.reply_to_message ? {
            messageId: msg.reply_to_message.message_id,
            text: msg.reply_to_message.text
          } : undefined,
          forumTopicId: msg.message_thread_id
        }
      }
    };
  } catch (e) {
    return { name: "telegram/transform.failed", data: { error: String(e), raw: evt } };
  }
}`;

// --- TypeScript version (for reference/type-checking) ---

import type { AgentMessageData } from "../types.ts";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    message_thread_id?: number;
    from?: { id: number; first_name: string; last_name?: string; username?: string };
    chat: { id: number; type: string; title?: string };
    text?: string;
    reply_to_message?: { message_id: number; text?: string };
  };
}

export function transform(evt: TelegramUpdate): { name: string; data: AgentMessageData } | undefined {
  if (!evt.message?.text) return undefined;

  const msg = evt.message;
  const text = msg.text!; // Safe — guarded by the check above
  const chatId = String(msg.chat.id);
  const displayName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "Unknown";

  return {
    name: "agent.message.received",
    data: {
      message: text,
      sessionKey: `telegram-${chatId}`,
      channel: "telegram",
      sender: {
        id: String(msg.from?.id || "unknown"),
        name: displayName,
        username: msg.from?.username,
      },
      destination: {
        chatId,
        messageId: String(msg.message_id),
        threadId: msg.message_thread_id ? String(msg.message_thread_id) : undefined,
      },
      channelMeta: {
        chatType: msg.chat.type,
        chatTitle: msg.chat.title,
        replyToMessage: msg.reply_to_message ? {
          messageId: msg.reply_to_message.message_id,
          text: msg.reply_to_message.text,
        } : undefined,
        forumTopicId: msg.message_thread_id,
      },
    },
  };
}
