/**
 * Setup — orchestrates channel setup at startup.
 *
 * Iterates over registered channels and runs their setup if configured.
 *
 * Run at startup (via worker.ts) or standalone:
 *   node --experimental-strip-types src/setup.ts
 */

import { logger } from "./lib/logger.ts";
import { config } from "./config.ts";
import { getChannel, getChannelNames } from "./channels/index.ts";

export async function setup(): Promise<void> {
  logger.info(`Setting up ${config.agent.name}...`);

  try {
    for (const name of getChannelNames()) {
      const handler = getChannel(name)!;

      if (!handler.setup) {
        logger.info({ channel: name }, `${name}: no setup needed`);
        continue;
      }

      // Check if the channel is configured (has required tokens)
      const channelConfig = config[name as keyof typeof config] as
        | Record<string, unknown>
        | undefined;
      if (!channelConfig?.botToken) {
        logger.info({ channel: name }, `${name}: skipped (no bot token configured)`);
        continue;
      }

      await handler.setup();
    }

    logger.info("Setup complete");
  } catch (err) {
    logger.fatal(err instanceof Error ? err : { err }, "Setup failed");
    process.exit(1);
  }
}

// Run standalone
const isMainModule = process.argv[1]?.endsWith("setup.ts");
if (isMainModule) {
  setup();
}
