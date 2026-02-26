/**
 * Global Failure Handler — catches all function failures.
 *
 * Logs errors and notifies the user via Telegram if the
 * original event came from a Telegram chat.
 */

import { inngest } from "../client.ts";
import { config } from "../config.ts";

export const failureHandler = inngest.createFunction(
  { id: "global-failure-handler", retries: 1, triggers: [{ event: "inngest/function.failed" }] },
  async ({ event, step }) => {
    const data = event.data as {
      error: { message: string };
      function_id: string;
      run_id: string;
      event: { name: string; data: Record<string, unknown> };
    };

    const functionId = data.function_id || "unknown";
    const errorMessage = data.error?.message || "Unknown error";
    const runId = data.run_id || "unknown";

    console.error(`[failure] ${functionId}: ${errorMessage}`);

    // Notify via Telegram if the original event came from there
    const chatId = data.event?.data?.chatId as string | undefined;
    const channel = data.event?.data?.channel as string | undefined;

    if (channel === "telegram" && chatId && config.telegram.botToken) {
      await step.run("notify-telegram", async () => {
        const text = [
          `⚠️ Something went wrong.`,
          ``,
          `<b>Error:</b> ${escapeHTML(errorMessage.slice(0, 150))}`,
          `<b>Function:</b> <code>${escapeHTML(functionId)}</code>`,
          `<b>Run:</b> <code>${escapeHTML(runId.slice(0, 12))}...</code>`,
        ].join("\n");

        await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
          signal: AbortSignal.timeout(10_000),
        });
      });
    }
  },
);

function escapeHTML(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
