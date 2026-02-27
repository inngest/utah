/**
 * Fetches all webhooks and prints their response functions.
 *
 * Usage: npx tsx scripts/list-webhook-responses.ts
 */

import { inngestFetch } from "../src/channels/setup-helpers.ts";

async function main() {
  const { data: webhooks } = await inngestFetch("/v2/env/webhooks");

  for (const wh of webhooks) {
    console.log(`── ${wh.name} (${wh.id})`);
    console.log(`   response: ${wh.response || "(none)"}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
