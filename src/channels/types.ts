/**
 * Channel interface — what every channel must implement.
 */

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
   * - Slack: 👀 emoji reaction
   * - Discord: typing indicator
   */
  acknowledge(params: AcknowledgeParams): Promise<void>;

  /**
   * Run channel-specific setup (create webhooks, verify tokens, etc).
   * Called once at startup.
   */
  setup?(): Promise<void>;
}

export interface SendReplyParams {
  /** The agent's response text (markdown) */
  response: string;
  /** Channel-specific chat/thread identifier */
  chatId: string;
  /** Optional: message ID to reply to/react to */
  messageId?: string;
}

export interface AcknowledgeParams {
  /** Channel-specific chat/thread identifier */
  chatId: string;
  /** Optional: message ID to acknowledge (e.g. for reactions) */
  messageId?: string;
}
