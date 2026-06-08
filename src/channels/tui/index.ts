/**
 * TUI channel — terminal UI over Inngest Realtime.
 *
 * The worker side (handler) publishes replies to a per-session realtime
 * channel. The CLI side (src/tui/) subscribes and renders. The channel
 * definition is shared via channel.ts.
 */

// Channel handler (implements ChannelHandler interface)
export { sendReply, acknowledge } from "./handler.ts";

// Shared realtime channel definition (also imported by the standalone CLI)
export { tuiChannel, TUI_TOPICS } from "./channel.ts";
export type { TuiReply, TuiStatus } from "./channel.ts";
