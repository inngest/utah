/**
 * Telegram Reply — sends agent responses back to Telegram.
 *
 * Listens for agent.reply.ready events. Converts markdown to
 * Telegram HTML, splits long messages, and falls back to plain
 * text if HTML parsing fails.
 */

import { inngest } from "../client.ts";
import { config } from "../config.ts";

const TELEGRAM_API = "https://api.telegram.org/bot";

export const telegramReply = inngest.createFunction(
  { id: "telegram-send-reply", retries: 3 },
  { event: "agent.reply.ready", if: 'event.data.channel == "telegram"' },
  async ({ event, step }) => {
    const { response, chatId, messageId } = event.data as {
      response: string;
      chatId: string;
      messageId?: string;
    };

    const botToken = config.telegram.botToken;
    if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN not set");

    // Send typing indicator
    await step.run("typing", async () => {
      await telegramAPI(botToken, "sendChatAction", { chat_id: chatId, action: "typing" });
    });

    // Split long messages (Telegram limit: 4096 chars)
    const chunks = splitMessage(response, 4000);

    for (let i = 0; i < chunks.length; i++) {
      await step.run(`send-chunk-${i}`, async () => {
        const body: Record<string, unknown> = {
          chat_id: chatId,
          text: markdownToTelegramHTML(chunks[i]),
          parse_mode: "HTML",
        };

        if (i === 0 && messageId) {
          body.reply_parameters = { message_id: parseInt(messageId) };
        }

        try {
          return await telegramAPI(botToken, "sendMessage", body);
        } catch (err: any) {
          // Fallback to plain text if HTML parsing fails
          if (err.message?.includes("can't parse entities")) {
            return await telegramAPI(botToken, "sendMessage", {
              chat_id: chatId,
              text: stripMarkdown(chunks[i]),
              ...(i === 0 && messageId ? { reply_parameters: { message_id: parseInt(messageId) } } : {}),
            });
          }
          throw err;
        }
      });
    }
  },
);

// --- Helpers ---

async function telegramAPI(botToken: string, method: string, body: Record<string, unknown>) {
  const res = await fetch(`${TELEGRAM_API}${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json()) as { ok: boolean; result?: any; description?: string };
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
  return data.result;
}

function splitMessage(text: string, maxLength: number): string[] {
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

function markdownToTelegramHTML(text: string): string {
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

function stripMarkdown(text: string): string {
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
