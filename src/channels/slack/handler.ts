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
  const { chatId, threadId } = destination;

  const chunks = splitMessage(response);

  for (const chunk of chunks) {
    try {
      await postMessage(chatId, markdownToSlackMrkdwn(chunk), {
        threadTs: threadId,
      });
    } catch (err: any) {
      // Fallback to plain text if formatting fails
      if (err.message?.includes("invalid_blocks") || err.message?.includes("invalid_attachments")) {
        await postMessage(chatId, stripMarkdown(chunk), {
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
export async function acknowledge({ destination }: AcknowledgeParams): Promise<void> {
  const { chatId, messageId } = destination;
  if (messageId) {
    await addReaction(chatId, messageId, "eyes");
  }
}

/**
 * Run Slack-specific setup (webhooks).
 */
export { setupSlack as setup } from "./setup.ts";