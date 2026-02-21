/**
 * Telegram channel — all Telegram-specific code lives here.
 */

// Channel handler (implements ChannelHandler interface)
export { sendReply, acknowledge, setup } from "./handler.ts";

// Setup
export { setupTelegram } from "./setup.ts";

// API (for direct use if needed)
export { telegramAPI, sendMessage, getMe } from "./api.ts";

// Transform source of truth
export { TRANSFORM_SOURCE } from "./transform.ts";

// Formatting
export { markdownToTelegramHTML, stripMarkdown, splitMessage } from "./format.ts";
