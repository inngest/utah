/**
 * Inngest Webhook Transform: Slack → agent.message.received
 *
 * This is the source of truth for the transform function that runs
 * inside Inngest Cloud. The setup script syncs this to the webhook
 * configuration automatically on startup.
 *
 * The transform must be plain JavaScript (no TypeScript, no imports)
 * since it executes in Inngest's sandboxed transform runtime.
 */

// Plain JS transform — synced to Inngest webhook by setup script
export const TRANSFORM_SOURCE = `function transform(evt, headers, queryParams) {
  try {
    // Handle Slack URL verification challenge
    if (evt.type === "url_verification") {
      return { name: "slack/url.verification", data: { challenge: evt.challenge } };
    }

    // Only process message events
    if (evt.type !== "event_callback" || !evt.event) {
      return { name: "slack/event.unsupported", data: evt };
    }

    var event = evt.event;
    
    // Only process message events with text (ignore bot messages, file uploads, etc)
    if (event.type !== "message" || !event.text || event.subtype || event.bot_id) {
      return { name: "slack/message.unsupported", data: evt };
    }

    var channelId = event.channel;
    var userId = event.user;
    var messageText = event.text;
    var messageTs = event.ts;
    var threadTs = event.thread_ts;

    // Create session key - use thread if available, otherwise channel
    var sessionKey = "slack-" + channelId + (threadTs ? "-" + threadTs : "");

    return {
      name: "agent.message.received",
      data: {
        message: messageText,
        sessionKey: sessionKey,
        channel: "slack",
        sender: {
          id: userId,
          name: "User", // Will be enriched by handler if needed
          username: undefined
        },
        destination: {
          chatId: channelId,
          messageId: messageTs,
          threadId: threadTs
        },
        channelMeta: {
          teamId: evt.team_id,
          eventId: evt.event_id,
          eventTime: evt.event_time,
          channelType: event.channel_type,
          threadTs: threadTs
        }
      }
    };
  } catch (e) {
    return { name: "slack/transform.failed", data: { error: String(e), raw: evt } };
  }
}`;

// --- TypeScript version (for reference/type-checking) ---

import type { AgentMessageData } from "../types.ts";

interface SlackEvent {
  type: string;
  challenge?: string; // URL verification
  team_id?: string;
  event_id?: string;
  event_time?: number;
  event?: {
    type: string;
    channel: string;
    user: string;
    text?: string;
    ts: string;
    thread_ts?: string;
    subtype?: string;
    bot_id?: string;
    channel_type?: string;
  };
}

export function transform(evt: SlackEvent): { name: string; data: any } | undefined {
  // Handle URL verification challenge
  if (evt.type === "url_verification") {
    return { name: "slack/url.verification", data: { challenge: evt.challenge } };
  }

  // Only process event callbacks
  if (evt.type !== "event_callback" || !evt.event) {
    return { name: "slack/event.unsupported", data: evt };
  }

  const event = evt.event;
  
  // Only process message events with text (ignore bot messages, file uploads, etc)
  if (event.type !== "message" || !event.text || event.subtype || event.bot_id) {
    return { name: "slack/message.unsupported", data: evt };
  }

  const sessionKey = `slack-${event.channel}${event.thread_ts ? `-${event.thread_ts}` : ""}`;

  const data: AgentMessageData = {
    message: event.text,
    sessionKey,
    channel: "slack",
    sender: {
      id: event.user,
      name: "User", // Will be enriched by handler if needed
    },
    destination: {
      chatId: event.channel,
      messageId: event.ts,
      threadId: event.thread_ts,
    },
    channelMeta: {
      teamId: evt.team_id,
      eventId: evt.event_id,
      eventTime: evt.event_time,
      channelType: event.channel_type,
      threadTs: event.thread_ts,
    },
  };

  return { name: "agent.message.received", data };
}