/**
 * Telegram message formatting utilities.
 *
 * Converts markdown to Telegram HTML, splits long messages,
 * and strips markdown for plain text fallback.
 */

const TELEGRAM_MAX_LENGTH = 4096;

/**
 * Convert markdown to Telegram-compatible HTML.
 */
export function markdownToTelegramHTML(text: string): string {
  let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  html = html.replace(/```\w*\n([\s\S]*?)```/g, (_m, code) => `<pre><code>${code.trimEnd()}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  html = html.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "<i>$1</i>");
  html = html.replace(/(?<!\w)_(.+?)_(?!\w)/g, "<i>$1</i>");
  html = html.replace(/~~(.+?)~~/g, "<s>$1</s>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
  return html;
}

/**
 * Strip markdown formatting for plain text fallback.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```\w*\n([\s\S]*?)```/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "$1")
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s+/gm, "");
}

/**
 * Split a message into chunks that fit Telegram's character limit.
 * Tries to split on paragraph breaks, then line breaks, then hard cut.
 */
export function splitMessage(text: string, maxLength = TELEGRAM_MAX_LENGTH - 96): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let idx = remaining.lastIndexOf("\n\n", maxLength);
    if (idx === -1 || idx < maxLength / 2) idx = remaining.lastIndexOf("\n", maxLength);
    if (idx === -1 || idx < maxLength / 2) idx = maxLength;
    chunks.push(remaining.slice(0, idx));
    remaining = remaining.slice(idx).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
