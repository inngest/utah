/**
 * Telegram channel setup — ensures Inngest webhook + Telegram bot webhook are configured.
 *
 * Called by the main setup script at startup.
 */

import { config } from "../../config.ts";
import { getMe, getWebhookInfo, setWebhook } from "./api.ts";
import { TRANSFORM_SOURCE } from "./transform.ts";
import { inngestFetch } from "../setup-helpers.ts";

const WEBHOOK_NAME = `Telegram - ${config.agent.name}`;

interface WebhookData {
  id: string;
  name: string;
  url: string;
  transform: string;
  response?: string;
  event_filter?: { events: string[]; filter: string };
  environment: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Ensure the Inngest webhook exists with the correct transform.
 */
export async function ensureInngestWebhook(): Promise<WebhookData> {
  console.log("🔍 Checking Inngest webhooks...");

  const { data: webhooks } = await inngestFetch("/v2/env/webhooks");

  let webhook: WebhookData | undefined = webhooks.find(
    (w: WebhookData) => w.name === WEBHOOK_NAME,
  );

  if (webhook) {
    console.log(`   Found existing webhook: ${webhook.id}`);

    // Compare transforms (normalize whitespace)
    const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
    if (normalize(webhook.transform || "") !== normalize(TRANSFORM_SOURCE)) {
      console.log("   ⚠️  Transform is out of date — recreating webhook...");
      const { data: created } = await inngestFetch("/v2/env/webhooks", {
        method: "POST",
        body: JSON.stringify({ name: WEBHOOK_NAME, transform: TRANSFORM_SOURCE }),
      });
      webhook = created;
      console.log(`   ✅ Recreated webhook: ${webhook!.id}`);
    } else {
      console.log("   ✅ Transform is up to date");
    }
  } else {
    console.log("   Creating new Inngest webhook...");
    const { data: created } = await inngestFetch("/v2/env/webhooks", {
      method: "POST",
      body: JSON.stringify({ name: WEBHOOK_NAME, transform: TRANSFORM_SOURCE }),
    });
    webhook = created;
    console.log(`   ✅ Created webhook: ${webhook!.id}`);
  }

  return webhook!;
}

/**
 * Ensure Telegram's webhook points at the Inngest webhook URL.
 */
export async function ensureTelegramWebhook(inngestWebhookUrl: string): Promise<void> {
  console.log("\n🔍 Checking Telegram webhook...");

  const info = await getWebhookInfo();

  if (info.url === inngestWebhookUrl) {
    console.log(`   ✅ Telegram webhook already set`);
    console.log(`   URL: ${inngestWebhookUrl}`);
    if (info.last_error_date) {
      const errorAge = Date.now() / 1000 - info.last_error_date;
      console.log(`   ⚠️  Last error (${Math.round(errorAge / 60)}min ago): ${info.last_error_message}`);
    }
    return;
  }

  console.log("   Setting Telegram webhook...");
  await setWebhook(inngestWebhookUrl);
  console.log(`   ✅ Telegram webhook set`);
  console.log(`   URL: ${inngestWebhookUrl}`);
}

/**
 * Full Telegram channel setup.
 */
export async function setupTelegram(): Promise<void> {
  const me = await getMe();
  console.log(`\n🤖 Bot: @${me.username} (${me.first_name})`);

  const webhook = await ensureInngestWebhook();
  await ensureTelegramWebhook(webhook.url);
}
