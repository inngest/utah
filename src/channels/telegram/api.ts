/**
 * Telegram Bot API client.
 *
 * Shared by all Telegram channel code: setup, reply, typing.
 */

import { config } from "../../config.ts";

const TELEGRAM_API = "https://api.telegram.org/bot";

function getBotToken(): string {
  const token = config.telegram.botToken;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
  return token;
}

/**
 * Call the Telegram Bot API.
 */
export async function telegramAPI(
  method: string,
  params: Record<string, unknown> = {},
  options: { timeout?: number } = {},
): Promise<any> {
  const token = getBotToken();
  const res = await fetch(`${TELEGRAM_API}${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(options.timeout ?? 10_000),
  });
  const data = (await res.json()) as { ok: boolean; result?: any; description?: string };
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
  return data.result;
}

/**
 * Send a text message to a Telegram chat.
 */
export async function sendMessage(
  chatId: string,
  text: string,
  options: { parseMode?: string; replyToMessageId?: number } = {},
): Promise<any> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };
  if (options.parseMode) body.parse_mode = options.parseMode;
  if (options.replyToMessageId) {
    body.reply_parameters = { message_id: options.replyToMessageId };
  }
  return telegramAPI("sendMessage", body);
}

/**
 * Send typing indicator to a chat.
 */
export async function sendTyping(chatId: string): Promise<void> {
  await telegramAPI("sendChatAction", { chat_id: chatId, action: "typing" }, { timeout: 5000 }).catch(() => {});
}

/**
 * Get bot info (username, name, etc).
 */
export async function getMe(): Promise<{ id: number; username: string; first_name: string }> {
  return telegramAPI("getMe");
}

/**
 * Get current webhook info.
 */
export async function getWebhookInfo(): Promise<{
  url: string;
  last_error_date?: number;
  last_error_message?: string;
}> {
  return telegramAPI("getWebhookInfo");
}

/**
 * Set the webhook URL for the bot.
 */
export async function setWebhook(url: string): Promise<void> {
  await telegramAPI("setWebhook", {
    url,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
}
