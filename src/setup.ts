/**
 * Setup — orchestrates channel setup at startup.
 *
 * Iterates over registered channels and runs their setup if configured.
 *
 * Run at startup (via worker.ts) or standalone:
 *   node --experimental-strip-types src/setup.ts
 */

import { config } from "./config.ts";
import { getChannel, getChannelNames } from "./channels/index.ts";

export async function setup(): Promise<void> {
  console.log(`\n🔧 Setting up ${config.agent.name}...\n`);

  try {
    for (const name of getChannelNames()) {
      const handler = getChannel(name)!;

      if (!handler.setup) {
        console.log(`⏭️  ${name}: no setup needed`);
        continue;
      }

      // Check if the channel is configured (has required tokens)
      const channelConfig = (config as any)[name];
      if (!channelConfig?.botToken) {
        console.log(`⏭️  ${name}: skipped (no bot token configured)`);
        continue;
      }

      await handler.setup();
    }

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
