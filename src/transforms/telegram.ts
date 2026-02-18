/**
 * Inngest Webhook Transform: Telegram → agent.message.received
 *
 * This runs inside Inngest Cloud when a Telegram webhook hits
 * the ingest endpoint. It converts Telegram Update objects into
 * agent events.
 *
 * Configure in the Inngest dashboard:
 *   Settings → Webhooks → Add Webhook → Enable Transform
 *
 * Paste the plain JS version below into the transform editor.
 */

// --- Plain JS version for the Inngest dashboard ---

/*
function transform(evt, headers, queryParams) {
  if (!evt.message?.text) return undefined;

  const msg = evt.message;
  const chatId = String(msg.chat.id);

  return {
    name: "agent.message.received",
    data: {
      message: msg.text,
      sessionKey: "telegram-" + chatId,
      channel: "telegram",
      senderId: String(msg.from?.id || "unknown"),
      senderName: msg.from?.first_name || "Unknown",
      chatId: chatId,
      messageId: String(msg.message_id),
      replyTo: {
        channel: "telegram",
        chatId: chatId,
        messageId: String(msg.message_id),
      },
    },
  };
}
*/

// --- TypeScript version (for reference) ---

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
      messageId: String(msg.message_id),
      replyTo: { channel: "telegram", chatId, messageId: String(msg.message_id) },
    },
  };
}
