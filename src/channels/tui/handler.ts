/**
 * TUI channel handler — implements the ChannelHandler interface.
 *
 * Unlike Telegram/Slack, there is no external API or webhook. Replies are
 * published to an Inngest Realtime channel scoped to the session id; the
 * standalone CLI (src/tui/) subscribes to that channel and renders them.
 *
 * The session id is carried in `destination.chatId` (set by the CLI when it
 * sends the agent.message.received event).
 */

import { inngest } from "../../client.ts";
import type { SendReplyParams, AcknowledgeParams } from "../types.ts";
import { tuiChannel } from "./channel.ts";

/**
 * Publish an agent reply to the session's realtime channel.
 *
 * Incremental replies (emitted mid-turn alongside tool calls) carry
 * `channelMeta.incremental === true`; everything else is the final answer.
 */
export async function sendReply({
  response,
  destination,
  channelMeta,
}: SendReplyParams): Promise<void> {
  const sessionId = destination.chatId;
  const final = !channelMeta?.incremental;

  await inngest.realtime.publish(tuiChannel(sessionId).reply, {
    content: response,
    final,
  });

  if (final) {
    // Let the TUI drop its thinking indicator immediately.
    await inngest.realtime.publish(tuiChannel(sessionId).status, { state: "idle" });
  }
}

/**
 * Acknowledge receipt — tell the TUI to show a thinking indicator.
 */
export async function acknowledge({ destination }: AcknowledgeParams): Promise<void> {
  const sessionId = destination.chatId;
  await inngest.realtime.publish(tuiChannel(sessionId).status, { state: "thinking" });
}
