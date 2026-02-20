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

    return {
      name: "agent.message.received",
      data: {
        message: msg.text,
        sessionKey: "telegram-" + chatId,
        channel: "telegram",
        senderId: String(msg.from && msg.from.id || "unknown"),
        senderName: (msg.from && msg.from.first_name) || "Unknown",
        chatId: chatId,
        chatType: msg.chat.type,
        messageId: String(msg.message_id),
        replyTo: {
          channel: "telegram",
          chatId: chatId,
          messageId: String(msg.message_id),
        },
      },
    };
  } catch (e) {
    return { name: "telegram/transform.failed", data: { error: String(e), raw: evt } };
  }
}`;

// --- TypeScript version (for reference/type-checking) ---

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name: string; last_name?: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
  };
}

export function transform(evt: TelegramUpdate) {
  if (!evt.message?.text) return undefined;

  const msg = evt.message;
  const chatId = String(msg.chat.id);
  const senderName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "Unknown";

  return {
    name: "agent.message.received",
    data: {
      message: msg.text,
      sessionKey: `telegram-${chatId}`,
      channel: "telegram",
      senderId: String(msg.from?.id || "unknown"),
      senderName,
      chatId,
      chatType: msg.chat.type,
      messageId: String(msg.message_id),
      replyTo: { channel: "telegram", chatId, messageId: String(msg.message_id) },
    },
  };
}
