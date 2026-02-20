/**
 * Setup — orchestrates channel setup at startup.
 *
 * Runs each configured channel's setup (webhook creation, transform sync, etc.)
 * and prints confirmation to the terminal.
 *
 * Run at startup (via worker.ts) or standalone:
 *   node --experimental-strip-types src/setup.ts
 */

import { config } from "./config.ts";
import { setupTelegram } from "./channels/telegram/index.ts";

export async function setup(): Promise<void> {
  console.log(`\n🔧 Setting up ${config.agent.name}...\n`);

  try {
    // Set up each configured channel
    if (config.telegram.botToken) {
      await setupTelegram();
    } else {
      console.log("⏭️  Telegram: skipped (no TELEGRAM_BOT_TOKEN)");
    }

    // Future channels:
    // if (config.slack?.botToken) await setupSlack();
    // if (config.discord?.botToken) await setupDiscord();

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
