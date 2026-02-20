/**
 * Telegram channel — all Telegram-specific code lives here.
 *
 * Exports:
 * - Inngest functions (reply, typing)
 * - Setup function
 * - API helpers
 * - Transform source
 */

// Inngest functions
export { telegramReply } from "./reply.ts";
export { telegramTyping } from "./typing.ts";

// Setup
export { setupTelegram } from "./setup.ts";

// API (for use by other modules if needed)
export { telegramAPI, sendMessage, sendTyping, getMe } from "./api.ts";

// Transform source of truth
export { TRANSFORM_SOURCE } from "./transform.ts";

// Formatting
export { markdownToTelegramHTML, stripMarkdown, splitMessage } from "./format.ts";
