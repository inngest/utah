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

// Plain JS response handler — responds to Slack's URL verification challenge
export const RESPONSE_SOURCE = `function respond(body, headers) {
  var parsed = JSON.parse(body);
  if (parsed && parsed.type === "url_verification" && parsed.challenge) {
    return { status: 200, headers: { "Content-Type": "text/plain" }, body: parsed.challenge };
  }
  // Otherwise return a plain response
  return { status: 200, headers: { "Content-Type": "text/plain" }, body: 'OK' }
}`;

// Plain JS transform — synced to Inngest webhook by setup script
export const TRANSFORM_SOURCE = `function transform(evt, headers, queryParams) {
  try {
    if (headers && headers["X-Slack-Retry-Num"]) {
      return { name: "slack/event.retry", data: { evt, headers } };
    }
    if (evt.type === "url_verification") {
      return { name: "slack/url.verification", data: { challenge: evt.challenge } };
    }
    if (evt.type !== "event_callback" || !evt.event) {
      return { name: "slack/event.unsupported", data: evt };
    }
    var e = evt.event;
    if ((e.type !== "message" && e.type !== "app_mention") || !e.text || e.subtype || e.bot_id) {
      return { id: "slack." + e.event_ts, name: "slack/message.unsupported", data: evt };
    }
    var ch = e.channel, ts = e.ts, tts = e.thread_ts, thread = tts || ts;
    return {
      id: "slack." + ch + "." + ts,
      name: "agent.message.received",
      data: {
        message: e.text,
        sessionKey: "slack-" + ch + "-" + thread,
        channel: "slack",
        sender: { id: e.user, name: "User" },
        destination: { chatId: ch + "-" + ts, threadId: thread, messageId: ts },
        channelMeta: {
          channelId: ch, teamId: evt.team_id, eventId: evt.event_id,
          eventTime: evt.event_time, eventType: e.type,
          channelType: e.channel_type, threadTs: thread
        },
        headers,
      }
    };
  } catch (err) {
    return { name: "slack/transform.failed", data: { error: String(err), raw: evt } };
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

export function transform(
  evt: SlackEvent,
): { id?: string; name: string; data: any } | undefined {
  // URL verification is handled by the response function;
  // return a no-op event so the transform doesn't error
  if (evt.type === "url_verification") {
    return {
      name: "slack/url.verification",
      data: { challenge: evt.challenge },
    };
  }

  // Only process event callbacks
  if (evt.type !== "event_callback" || !evt.event) {
    return { name: "slack/event.unsupported", data: evt };
  }

  const event = evt.event;

  // Only process message and app_mention events with text (ignore bot messages, file uploads, etc)
  if (
    (event.type !== "message" && event.type !== "app_mention") ||
    !event.text ||
    event.subtype ||
    event.bot_id
  ) {
    return { name: "slack/message.unsupported", data: evt };
  }

  // Always thread-scope: use thread_ts if in a thread, or ts to start a new thread
  const thread = event.thread_ts || event.ts;
  const sessionKey = `slack-${event.channel}-${thread}`;

  const data: AgentMessageData = {
    message: event.text,
    sessionKey,
    channel: "slack",
    sender: {
      id: event.user,
      name: "User", // Will be enriched by handler if needed
    },
    destination: {
      chatId: `${event.channel}-${event.ts}`,
      messageId: event.ts,
      threadId: thread,
    },
    channelMeta: {
      channelId: event.channel,
      teamId: evt.team_id,
      eventId: evt.event_id,
      eventTime: evt.event_time,
      channelType: event.channel_type,
      threadTs: thread,
    },
  };

  return {
    id: `slack.${event.channel}.${event.ts}`,
    name: "agent.message.received",
    data,
  };
}
