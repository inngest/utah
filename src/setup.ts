/**
 * Setup — ensures Telegram webhook + Inngest webhook with transform are configured.
 *
 * Run at startup or standalone:
 *   node --experimental-strip-types src/setup.ts
 *
 * Steps:
 * 1. List existing Inngest webhooks, find or create one for Telegram
 * 2. Ensure the transform function is up to date
 * 3. Set the Telegram Bot API webhook URL to point at the Inngest webhook
 * 4. Print confirmation/results
 *
 * Required env vars:
 *   TELEGRAM_BOT_TOKEN — from @BotFather
 *   INNGEST_SIGNING_KEY — for Inngest REST API auth
 */

import { config } from "./config.ts";

// --- Inngest API ---

const INNGEST_API = "https://api.inngest.com/v1";

function getSigningKey(): string {
  const key = process.env.INNGEST_SIGNING_KEY;
  if (!key) throw new Error("INNGEST_SIGNING_KEY is required");
  return key;
}

async function inngestFetch(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${INNGEST_API}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${getSigningKey()}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Inngest API ${path}: ${res.status} — ${JSON.stringify(json)}`);
  }
  return json;
}

// --- Transform ---

// The plain JS transform function that runs inside Inngest Cloud.
// This is the source of truth — the setup script syncs it to the webhook.
const TRANSFORM_SOURCE = `function transform(evt, headers, queryParams) {
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

const WEBHOOK_NAME = `Telegram - ${config.agent.name}`;

// --- Telegram API ---

async function telegramAPI(method: string, params: Record<string, any> = {}): Promise<any> {
  const token = config.telegram.botToken;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");

  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (!json.ok) {
    throw new Error(`Telegram API ${method}: ${JSON.stringify(json)}`);
  }
  return json.result;
}

// --- Setup Logic ---

interface WebhookData {
  id: string;
  name: string;
  url: string;
  transform: string;
  created_at: string;
  updated_at: string;
}

async function ensureInngestWebhook(): Promise<WebhookData> {
  console.log("🔍 Checking Inngest webhooks...");

  // List existing webhooks
  const { data: webhooks } = await inngestFetch("/webhooks");

  // Find existing webhook by name
  let webhook: WebhookData | undefined = webhooks.find(
    (w: WebhookData) => w.name === WEBHOOK_NAME,
  );

  if (webhook) {
    console.log(`   Found existing webhook: ${webhook.id}`);

    // Check if transform needs updating
    // Normalize whitespace for comparison
    const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
    const currentTransform = normalize(webhook.transform || "");
    const desiredTransform = normalize(TRANSFORM_SOURCE);

    if (currentTransform !== desiredTransform) {
      console.log("   ⚡ Transform is out of date — updating...");
      const { data: updated } = await inngestFetch(`/webhooks/${webhook.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: WEBHOOK_NAME,
          transform: TRANSFORM_SOURCE,
        }),
      });
      webhook = updated;
      console.log("   ✅ Transform updated");
    } else {
      console.log("   ✅ Transform is up to date");
    }
  } else {
    // Create new webhook
    console.log("   Creating new Inngest webhook...");
    const { data: created } = await inngestFetch("/webhooks", {
      method: "POST",
      body: JSON.stringify({
        name: WEBHOOK_NAME,
        transform: TRANSFORM_SOURCE,
      }),
    });
    webhook = created;
    console.log(`   ✅ Created webhook: ${webhook!.id}`);
  }

  return webhook!;
}

async function ensureTelegramWebhook(inngestWebhookUrl: string): Promise<void> {
  console.log("\n🔍 Checking Telegram webhook...");

  // Get current webhook info
  const info = await telegramAPI("getWebhookInfo");

  if (info.url === inngestWebhookUrl) {
    console.log(`   ✅ Telegram webhook already set`);
    console.log(`   URL: ${inngestWebhookUrl}`);
    if (info.last_error_date) {
      const errorAge = Date.now() / 1000 - info.last_error_date;
      console.log(`   ⚠️  Last error (${Math.round(errorAge / 60)}min ago): ${info.last_error_message}`);
    }
    return;
  }

  // Set webhook
  console.log("   Setting Telegram webhook...");
  await telegramAPI("setWebhook", {
    url: inngestWebhookUrl,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
  console.log(`   ✅ Telegram webhook set`);
  console.log(`   URL: ${inngestWebhookUrl}`);
}

async function getBotInfo(): Promise<void> {
  const me = await telegramAPI("getMe");
  console.log(`\n🤖 Bot: @${me.username} (${me.first_name})`);
}

// --- Main ---

export async function setup(): Promise<void> {
  console.log(`\n🔧 Setting up ${config.agent.name}...\n`);

  try {
    // Verify bot token
    await getBotInfo();

    // Ensure Inngest webhook exists with correct transform
    const webhook = await ensureInngestWebhook();

    // Point Telegram at the Inngest webhook URL
    await ensureTelegramWebhook(webhook.url);

    console.log("\n✅ Setup complete!\n");
  } catch (err) {
    console.error("\n❌ Setup failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

// Run standalone
const isMainModule = process.argv[1]?.endsWith("setup.ts");
if (isMainModule) {
  setup();
}
