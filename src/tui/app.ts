/**
 * TUI app — wires the renderer to Inngest Realtime and local session state.
 *
 * Flow:
 *   - User submits a line → send an `agent.message.received` event directly to
 *     Inngest (the TUI is a trusted local client with the event key).
 *   - The worker's agent loop runs and the TUI channel handler publishes
 *     replies to the realtime channel `tui:<sessionId>`.
 *   - We subscribe to that channel and render `reply` / `status` messages.
 *
 * Slash commands (handled locally, never sent to the agent):
 *   /clear     end this session and start a fresh one
 *   /sessions  list known sessions
 *   /new       alias for /clear
 *   /help      show commands
 *   /exit      quit
 */

import os from "node:os";
import { getSubscriptionToken, subscribe } from "inngest/realtime";
import { inngest } from "./client.ts";
import { tuiChannel, TUI_TOPICS, type TuiReply, type TuiStatus } from "../channels/tui/channel.ts";
import { Tui } from "./ui.ts";
import { log, LOG_PATH } from "./log.ts";
import {
  createSession,
  getSession,
  listSessions,
  touchSession,
  appendTranscript,
  loadTranscript,
  type SessionMeta,
} from "./state.ts";

/** A realtime stream handle (the ReadableStream form, with a close()). */
interface StreamHandle extends ReadableStream<RealtimeMessage> {
  close(reason?: string): void;
}

/** Loose shape for realtime frames — wide enough for all of our topics. */
interface RealtimeMessage {
  topic?: string;
  data?: unknown;
  kind?: string;
}

const username = os.userInfo().username || "you";
const RECONNECT_DELAY_MS = 1000;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class App {
  private tui: Tui;
  private session!: SessionMeta;
  private stream: StreamHandle | null = null;
  /** Bumped to invalidate the running subscribe loop (e.g. on /clear or exit). */
  private subGen = 0;
  private stopped = false;
  /** Ring the terminal bell when a run finishes (toggle with /bell). */
  private bellEnabled = true;

  constructor() {
    this.tui = new Tui("Utah", {
      onSubmit: (line) => void this.handleSubmit(line),
      onExit: () => this.shutdown(),
    });
  }

  async start(sessionId?: string): Promise<void> {
    this.session = (sessionId && (await getSession(sessionId))) || (await createSession());

    this.tui.start();
    this.tui.setHeader(this.headerText());

    // Replay any local transcript so a resumed window shows its history.
    for (const line of await loadTranscript(this.session.id)) {
      this.tui.addMessage(line.role, line.content);
    }
    this.tui.addMessage(
      "system",
      `Connected to session ${this.session.id}. Type a message, or /help for commands.`,
    );
    log("tui started", { session: this.session.id, logPath: LOG_PATH });

    // Long-running loop — don't await it.
    void this.subscribeLoop(this.session.id, ++this.subGen);
  }

  // --- realtime ---

  /**
   * Subscribe and keep the stream alive. The Inngest realtime client does not
   * reconnect on its own: when the WebSocket drops (e.g. an idle connection is
   * closed by the gateway while the agent runs tools), the stream simply ends.
   * We detect that and re-subscribe, so a later reply isn't lost forever.
   *
   * `gen` guards against stale loops: /clear and exit bump `subGen`, which
   * makes any older loop stop after its current read.
   */
  private async subscribeLoop(sessionId: string, gen: number): Promise<void> {
    while (!this.stopped && gen === this.subGen) {
      try {
        // Per the requested flow: mint a short-lived subscription token from
        // our credentials, then open the realtime stream with it.
        const token = await getSubscriptionToken(inngest, {
          channel: tuiChannel(sessionId),
          topics: [...TUI_TOPICS],
        });
        const stream = (await subscribe({ app: inngest, ...token })) as StreamHandle;
        this.stream = stream;
        log("subscribed", { session: sessionId, gen });

        const reader = stream.getReader();
        try {
          while (gen === this.subGen) {
            const { done, value } = await reader.read();
            if (done) break;
            this.onRealtime(value);
          }
        } finally {
          reader.releaseLock();
        }
        log("subscription stream ended", { session: sessionId, gen });
      } catch (err) {
        log("subscription error", { session: sessionId, gen, error: String(err) });
      }

      if (this.stopped || gen !== this.subGen) break;
      // Reconnect. Messages published while we were disconnected are lost —
      // realtime has no replay — but future replies will come through.
      await delay(RECONNECT_DELAY_MS);
      log("reconnecting subscription", { session: sessionId, gen });
    }
  }

  private onRealtime(message: RealtimeMessage): void {
    log("realtime message", { topic: message.topic, kind: message.kind });
    if (message.kind && message.kind !== "data") return; // ignore run lifecycle frames
    if (message.topic === "reply") {
      const reply = message.data as TuiReply;
      this.tui.appendAssistant(reply.content);
      if (reply.final) {
        this.tui.setThinking(false);
        if (this.bellEnabled) this.tui.bell(); // notify that the run is done
        void appendTranscript(this.session.id, "assistant", reply.content);
      }
    } else if (message.topic === "status") {
      const status = message.data as TuiStatus;
      this.tui.setThinking(status.state === "thinking");
    }
  }

  private closeStream(): void {
    if (this.stream) {
      try {
        this.stream.close();
      } catch {
        /* best-effort */
      }
      this.stream = null;
    }
  }

  private async resubscribe(): Promise<void> {
    this.subGen++; // invalidate the current loop
    this.closeStream(); // unblock its reader so it exits promptly
    void this.subscribeLoop(this.session.id, this.subGen);
  }

  // --- input handling ---

  private async handleSubmit(line: string): Promise<void> {
    if (line.startsWith("/")) return this.handleCommand(line);

    this.tui.addMessage("user", line);
    this.tui.setThinking(true);
    void appendTranscript(this.session.id, "user", line);
    void touchSession(this.session.id, line);

    try {
      const { ids } = await inngest.send({
        name: "agent.message.received",
        data: {
          message: line,
          sessionKey: this.session.id,
          channel: "tui",
          sender: { id: username, name: username },
          destination: { chatId: this.session.id },
          channelMeta: {},
        },
      });
      log("sent message", { session: this.session.id, eventIds: ids });
    } catch (err) {
      log("send failed", { session: this.session.id, error: String(err) });
      this.tui.setThinking(false);
      this.tui.addMessage(
        "system",
        `⚠ Failed to send message: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async handleCommand(line: string): Promise<void> {
    const [cmd, ...rest] = line.slice(1).split(/\s+/);
    switch (cmd) {
      case "clear":
      case "new":
        await this.startNewSession();
        break;
      case "sessions": {
        const sessions = await listSessions();
        const body = sessions
          .map(
            (s) =>
              `${s.id === this.session.id ? "→" : " "} ${s.id}  ${s.title ?? "(untitled)"}  ` +
              `${new Date(s.lastActiveAt).toLocaleString()}`,
          )
          .join("\n");
        this.tui.addMessage("system", body || "No sessions yet.");
        break;
      }
      case "bell": {
        const arg = rest[0]?.toLowerCase();
        this.bellEnabled = arg === "on" ? true : arg === "off" ? false : !this.bellEnabled;
        this.tui.addMessage("system", `Notification bell ${this.bellEnabled ? "on" : "off"}.`);
        break;
      }
      case "help":
        this.tui.addMessage(
          "system",
          [
            "Commands:",
            "  /clear, /new   end this session and start a fresh one",
            "  /sessions      list known sessions",
            "  /bell [on|off] toggle the done-notification sound",
            "  /help          show this help",
            "  /exit, /quit   quit",
            "",
            "Keys: Enter send · Shift+Enter newline · Ctrl+C clear (twice to exit)",
            "      Ctrl+L redraw · ↑/↓ history · mouse wheel / PgUp / PgDn scroll",
          ].join("\n"),
        );
        break;
      case "exit":
      case "quit":
        return this.shutdown();
      default:
        this.tui.addMessage("system", `Unknown command: /${cmd}. Try /help.`);
    }
  }

  private async startNewSession(): Promise<void> {
    this.tui.setThinking(false);
    this.session = await createSession();
    this.tui.clearMessages();
    this.tui.setHeader(this.headerText());
    this.tui.addMessage("system", `Started new session ${this.session.id}.`);
    await this.resubscribe();
  }

  // --- helpers ---

  private headerText(): string {
    const mode = process.env.INNGEST_DEV ? "dev" : "cloud";
    return `Utah · ${this.session.id} · ${mode}`;
  }

  private shutdown(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.subGen++; // stop the subscribe loop
    this.closeStream();
    log("tui shutdown", { session: this.session?.id });
    this.tui.stop();
    process.exit(0);
  }
}
