/**
 * Send Reply — generic Inngest function that dispatches to the correct channel.
 *
 * Listens for agent.reply.ready events and routes to the appropriate
 * channel handler based on event.data.channel.
 *
 * One function handles all channels — no per-channel Inngest functions needed.
 */

import { inngest, agentReplyReady } from "../client.ts";
import { getChannel } from "../channels/index.ts";

export const sendReply = inngest.createFunction(
  { id: "send-reply", retries: 3, triggers: [agentReplyReady] },
  async ({ event, step }) => {
    const { response, channel, destination, channelMeta } = event.data;

    const handler = getChannel(channel);
    if (!handler) {
      console.warn(`Unknown channel: ${channel}`);
      return { error: `Unknown channel: ${channel}` };
    }

    await step.run("send", async () => {
      await handler.sendReply({ response, destination, channelMeta });
    });
  },
);
