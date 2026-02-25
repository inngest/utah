/**
 * Slack channel setup — ensures Inngest webhook is configured.
 *
 * Called by the main setup script at startup.
 */

import { config } from "../../config.ts";
import { authTest } from "./api.ts";
import { TRANSFORM_SOURCE, RESPONSE_SOURCE } from "./transform.ts";
import { inngestFetch } from "../setup-helpers.ts";

const WEBHOOK_NAME = `Slack - ${config.agent.name}`;

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

    // Compare transforms and response handler (normalize whitespace)
    const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
    const transformStale =
      normalize(webhook.transform || "") !== normalize(TRANSFORM_SOURCE);
    const responseStale =
      normalize(webhook.response || "") !== normalize(RESPONSE_SOURCE);
    if (transformStale || responseStale) {
      console.log("   ⚠️  Webhook config is out of date — recreating...");
      const { data: created } = await inngestFetch("/v2/env/webhooks", {
        method: "POST",
        body: JSON.stringify({
          name: WEBHOOK_NAME,
          transform: TRANSFORM_SOURCE,
          response: RESPONSE_SOURCE,
        }),
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
      body: JSON.stringify({
        name: WEBHOOK_NAME,
        transform: TRANSFORM_SOURCE,
        response: RESPONSE_SOURCE,
      }),
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
  console.log(
    "   Configure this URL in your Slack app's Event Subscriptions settings",
  );
  console.log(
    "   Subscribe to: message.channels, message.groups, message.im, message.mpim",
  );
}
