/**
 * Channel abstraction — generic interface for messaging channels.
 *
 * Each channel implements ChannelHandler. The dispatcher routes
 * events to the correct channel based on event.data.channel.
 *
 * Adding a new channel:
 * 1. Create src/channels/<name>/ with api.ts, format.ts, etc.
 * 2. Export a ChannelHandler from its index.ts
 * 3. Register it in the CHANNELS map below
 * 4. Add its setup to the setupChannels() function
 */

import type { ChannelHandler } from "./types.ts";
import * as telegram from "./telegram/handler.ts";
import * as slack from "./slack/handler.ts";

// --- Channel Registry ---

const CHANNELS: Record<string, ChannelHandler> = {
  telegram,
  slack,
  // discord: discordHandler,
};

/**
 * Get the handler for a channel by name.
 */
export function getChannel(name: string): ChannelHandler | undefined {
  return CHANNELS[name];
}

/**
 * Get all registered channel names.
 */
export function getChannelNames(): string[] {
  return Object.keys(CHANNELS);
}
