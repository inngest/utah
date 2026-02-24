/**
 * Slack channel setup — ensures Inngest webhook is configured.
 *
 * Called by the main setup script at startup.
 */

import { config } from "../../config.ts";
import { authTest } from "./api.ts";
import { TRANSFORM_SOURCE } from "./transform.ts";
import { inngestFetch } from "../setup-helpers.ts";

const WEBHOOK_NAME = `Slack - ${config.agent.name}`;

interface WebhookData {
  id: string;
  name: string;
  url: string;
  transform: string;
  created_at: string;
  updated_at: string;
}

/**
 * Ensure the Inngest webhook exists with the correct transform.
 */
export async function ensureInngestWebhook(): Promise<WebhookData> {
  console.log("🔍 Checking Inngest webhooks...");

  const { data: webhooks } = await inngestFetch("/webhooks");

  let webhook: WebhookData | undefined = webhooks.find(
    (w: WebhookData) => w.name === WEBHOOK_NAME,
  );

  if (webhook) {
    console.log(`   Found existing webhook: ${webhook.id}`);

    // Compare transforms (normalize whitespace)
    const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
    if (normalize(webhook.transform || "") !== normalize(TRANSFORM_SOURCE)) {
      console.log("   ⚡ Transform is out of date — updating...");
      const { data: updated } = await inngestFetch(`/webhooks/${webhook.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: WEBHOOK_NAME, transform: TRANSFORM_SOURCE }),
      });
      webhook = updated;
      console.log("   ✅ Transform updated");
    } else {
      console.log("   ✅ Transform is up to date");
    }
  } else {
    console.log("   Creating new Inngest webhook...");
    const { data: created } = await inngestFetch("/webhooks", {
      method: "POST",
      body: JSON.stringify({ name: WEBHOOK_NAME, transform: TRANSFORM_SOURCE }),
    });
    webhook = created;
    console.log(`   ✅ Created webhook: ${webhook!.id}`);
  }

  return webhook!;
}

/**
 * Full Slack channel setup.
 */
export async function setupSlack(): Promise<void> {
  const auth = await authTest();
  console.log(`\n💬 Slack Bot: ${auth.user} (Team: ${auth.team})`);
  
  const webhook = await ensureInngestWebhook();
  console.log(`\n📋 Slack webhook URL: ${webhook.url}`);
  console.log("   Configure this URL in your Slack app's Event Subscriptions settings");
  console.log("   Subscribe to: message.channels, message.groups, message.im, message.mpim");
}