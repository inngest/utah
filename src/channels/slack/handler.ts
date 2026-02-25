/**
 * Slack channel handler — implements the ChannelHandler interface.
 */

import type { SendReplyParams, AcknowledgeParams } from "../types.ts";
import { postMessage, addReaction } from "./api.ts";
import { markdownToSlackMrkdwn, stripMarkdown, splitMessage } from "./format.ts";

/**
 * Slack-specific metadata passed through channelMeta.
 */
interface SlackMeta {
  channelId?: string;
  teamId?: string;
  eventId?: string;
  eventTime?: number;
  channelType?: string;
  threadTs?: string;
}

/**
 * Send an agent reply to Slack. Handles mrkdwn conversion,
 * message splitting, and plain text fallback.
 */
export async function sendReply({ response, destination, channelMeta }: SendReplyParams): Promise<void> {
  const { threadId } = destination;
  const meta = channelMeta as SlackMeta;
  // Use the raw Slack channel ID from channelMeta (chatId is a compound routing key)
  const channel = meta.channelId ?? destination.chatId;

  const chunks = splitMessage(response);

  for (const chunk of chunks) {
    try {
      await postMessage(channel, markdownToSlackMrkdwn(chunk), {
        threadTs: threadId,
      });
    } catch (err: any) {
      // Fallback to plain text if formatting fails
      if (err.message?.includes("invalid_blocks") || err.message?.includes("invalid_attachments")) {
        await postMessage(channel, stripMarkdown(chunk), {
          threadTs: threadId,
        });
      } else {
        throw err;
      }
    }
  }
}

/**
 * Acknowledge message receipt — Slack adds a 👀 emoji reaction.
 */
export async function acknowledge({ destination, channelMeta }: AcknowledgeParams): Promise<void> {
  const meta = channelMeta as SlackMeta;
  // Use the raw Slack channel ID from channelMeta (chatId is a compound routing key)
  const channel = meta.channelId ?? destination.chatId;
  const { messageId } = destination;
  if (messageId) {
    await addReaction(channel, messageId, "eyes");
  }
}

/**
 * Run Slack-specific setup (webhooks).
 */
export { setupSlack as setup } from "./setup.ts";