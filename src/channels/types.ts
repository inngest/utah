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
   * Show a typing/activity indicator. Best-effort — failures are swallowed.
   */
  sendTyping(params: SendTypingParams): Promise<void>;

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
  /** Optional: message ID to reply to */
  messageId?: string;
}

export interface SendTypingParams {
  /** Channel-specific chat/thread identifier */
  chatId: string;
}
