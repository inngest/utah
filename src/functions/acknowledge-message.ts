/**
 * Acknowledge Message — generic Inngest function that dispatches to the correct channel.
 *
 * Listens for agent.message.received events and acknowledges receipt
 * on the appropriate channel. Best-effort: no retries.
 *
 * What "acknowledge" means per channel:
 * - Telegram: typing indicator
 * - Slack: 👀 emoji reaction on the message
 * - Discord: typing indicator
 */

import { inngest, agentMessageReceived } from "../client.ts";
import { getChannel } from "../channels/index.ts";

export const acknowledgeMessage = inngest.createFunction(
  { id: "acknowledge-message", retries: 0, triggers: [agentMessageReceived] },
  async ({ event, step }) => {
    const { channel, destination, channelMeta } = event.data;

    if (!destination?.chatId) return;

    const handler = getChannel(channel);
    if (!handler) return;

    await step.run("acknowledge", async () => {
      await handler.acknowledge({ destination, channelMeta });
    });
  },
);
