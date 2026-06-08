/**
 * TUI realtime channel definition.
 *
 * This is the shared contract between the worker (which publishes replies)
 * and the standalone CLI (which subscribes). It deliberately imports ONLY
 * from `inngest/realtime` — no worker client, no pino logger — so the CLI can
 * import it without pulling stdout-logging or tracing middleware into the
 * terminal process.
 *
 * Channels are scoped per session id, so each terminal window only ever sees
 * the replies for its own session.
 */

import { channel, staticSchema } from "inngest/realtime";

/** A reply chunk pushed to the TUI. */
export type TuiReply = {
  /** Markdown text content. */
  content: string;
  /**
   * Whether this is the final reply for the turn. Incremental replies (text
   * the model emits before calling tools) arrive with `final: false`; the
   * closing answer arrives with `final: true`.
   */
  final: boolean;
};

/** A lightweight status signal so the TUI can show/hide a thinking indicator. */
export type TuiStatus = {
  state: "thinking" | "idle";
  /** Optional human-readable detail (e.g. the tool currently running). */
  detail?: string;
};

/**
 * Per-session realtime channel: `tui:<sessionId>`.
 *
 * Usage (publish):   inngest.realtime.publish(tuiChannel(sessionId).reply, {...})
 * Usage (subscribe): subscribe({ channel: tuiChannel(sessionId), topics: [...] })
 */
export const tuiChannel = channel({
  name: (sessionId: string) => `tui:${sessionId}`,
  topics: {
    reply: { schema: staticSchema<TuiReply>() },
    status: { schema: staticSchema<TuiStatus>() },
  },
});

/** Topics the CLI subscribes to. Exported so both sides stay in sync. */
export const TUI_TOPICS = ["reply", "status"] as const;
