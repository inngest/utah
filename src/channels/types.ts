/**
 * Channel types — the contract every channel must implement.
 */

// --- Channel Handler Interface ---

export interface ChannelHandler {
  /**
   * Send a message to the destination (chat, thread, DM, etc).
   * Handles formatting, splitting, and fallbacks internally.
   */
  sendReply(params: SendReplyParams): Promise<void>;

  /**
   * Acknowledge receipt of a message. Best-effort — failures are swallowed.
   * Each channel decides what this looks like:
   * - Telegram: typing indicator
   * - Slack: 👀 emoji reaction on the message
   * - Discord: typing indicator
   */
  acknowledge(params: AcknowledgeParams): Promise<void>;

  /**
   * Run channel-specific setup (create webhooks, verify tokens, etc).
   * Called once at startup.
   */
  setup?(): Promise<void>;
}

// --- Event Data Types ---

/**
 * Normalized sender info — same across all channels.
 */
export interface Sender {
  /** Channel-specific user ID */
  id: string;
  /** Display name */
  name: string;
  /** Handle/username if available */
  username?: string;
}

/**
 * Where to send replies — normalized with channel-agnostic fields.
 */
export interface Destination {
  /** Primary destination (chat ID, channel ID, DM ID) */
  chatId: string;
  /** Message to reply to or react to */
  messageId?: string;
  /** Thread context (Slack thread_ts, Discord thread, Telegram forum topic) */
  threadId?: string;
}

/**
 * The normalized event data shape for agent.message.received.
 * Transforms produce this, the agent loop consumes it.
 */
export type AgentMessageData = {
  /** The text content */
  message: string;
  /** Unique session identifier (e.g. "telegram-12345") */
  sessionKey: string;
  /** Channel name */
  channel: string;
  /** Normalized sender info */
  sender: Sender;
  /** Where to send replies */
  destination: Destination;
  /** Channel-specific metadata — opaque to the agent, passed to handlers */
  channelMeta: Record<string, unknown>;
};

/**
 * The normalized event data shape for agent.reply.ready.
 * Agent loop produces this, channel handlers consume it.
 */
export type AgentReplyData = {
  /** The agent's response text (markdown) */
  response: string;
  /** Channel name — used for dispatch */
  channel: string;
  /** Where to send the reply */
  destination: Destination;
  /** Channel-specific metadata — passed through from the incoming event */
  channelMeta: Record<string, unknown>;
};

// --- Handler Params ---

export interface SendReplyParams {
  /** The agent's response text (markdown) */
  response: string;
  /** Where to send */
  destination: Destination;
  /** Channel-specific metadata */
  channelMeta: Record<string, unknown>;
}

export interface AcknowledgeParams {
  /** Where to acknowledge */
  destination: Destination;
  /** Channel-specific metadata */
  channelMeta: Record<string, unknown>;
}
