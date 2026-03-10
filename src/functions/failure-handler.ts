/**
 * Global Failure Handler — catches all function failures.
 *
 * Logs errors and notifies the user via the originating channel
 * (Telegram, Slack, etc.) if the original event came from one.
 */

import { inngest } from "../client.ts";
import { getChannel } from "../channels/index.ts";
import type { Destination } from "../channels/types.ts";

interface FailureEventData {
  error: { message: string };
  function_id: string;
  run_id: string;
  event: {
    name: string;
    data: {
      channel?: string;
      destination?: Destination;
      channelMeta?: Record<string, unknown>;
      [key: string]: unknown;
    };
  };
}

export const failureHandler = inngest.createFunction(
  { id: "global-failure-handler", retries: 1, triggers: [{ event: "inngest/function.failed" }] },
  async ({ event, step, logger }) => {
    const data = event.data as FailureEventData;

    const functionId = data.function_id || "unknown";
    const errorMessage = data.error?.message || "Unknown error";
    const runId = data.run_id || "unknown";

    logger.error({ functionId, runId, errorMessage }, `[failure] ${functionId}: ${errorMessage}`);

    const channel = data.event?.data?.channel;
    const handler = channel ? getChannel(channel) : undefined;

    if (handler) {
      const destination = data.event?.data?.destination as Destination;
      const channelMeta = data.event?.data?.channelMeta || {};

      await step.run("notify-channel", async () => {
        const response = [
          `**Something went wrong.**`,
          ``,
          `**Error:** ${errorMessage.slice(0, 150)}`,
          `**Function:** \`${functionId}\``,
          `**Run:** \`${runId.slice(0, 12)}...\``,
        ].join("\n");

        await handler.sendReply({ response, destination, channelMeta });
      });
    }
  },
);
