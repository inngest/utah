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
import {
  createSession,
  getSession,
  listSessions,
  touchSession,
  appendTranscript,
  loadTranscript,
  type SessionMeta,
} from "./state.ts";

/** Minimal handle returned by a callback-style subscription. */
interface Subscription {
  close(reason?: string): void;
  unsubscribe(reason?: string): void;
}

/** Loose shape for realtime frames — wide enough for all of our topics. */
interface RealtimeMessage {
  topic?: string;
  data?: unknown;
  kind?: string;
}

const username = os.userInfo().username || "you";

export class App {
  private tui: Tui;
  private session!: SessionMeta;
  private subscription: Subscription | null = null;
  private stopped = false;

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

    await this.subscribeToSession();
  }

  // --- realtime ---

  private async subscribeToSession(): Promise<void> {
    try {
      // Per the requested flow: use credentials to mint a short-lived
      // subscription token, then open the realtime stream with it.
      const token = await getSubscriptionToken(inngest, {
        channel: tuiChannel(this.session.id),
        topics: [...TUI_TOPICS],
      });

      this.subscription = await subscribe({
        app: inngest,
        ...token,
        onMessage: (message: RealtimeMessage) => this.onRealtime(message),
      });
    } catch (err) {
      this.tui.addMessage(
        "system",
        `⚠ Realtime subscription failed: ${err instanceof Error ? err.message : String(err)}. ` +
          `Replies won't stream in. Check INNGEST keys / dev server.`,
      );
    }
  }

  private onRealtime(message: RealtimeMessage): void {
    if (message.kind && message.kind !== "data") return; // ignore run lifecycle frames
    if (message.topic === "reply") {
      const reply = message.data as TuiReply;
      this.tui.appendAssistant(reply.content);
      if (reply.final) {
        this.tui.setThinking(false);
        void appendTranscript(this.session.id, "assistant", reply.content);
      }
    } else if (message.topic === "status") {
      const status = message.data as TuiStatus;
      this.tui.setThinking(status.state === "thinking");
    }
  }

  private async resubscribe(): Promise<void> {
    if (this.subscription) {
      try {
        this.subscription.close();
      } catch {
        /* best-effort */
      }
      this.subscription = null;
    }
    await this.subscribeToSession();
  }

  // --- input handling ---

  private async handleSubmit(line: string): Promise<void> {
    if (line.startsWith("/")) return this.handleCommand(line);

    this.tui.addMessage("user", line);
    this.tui.setThinking(true);
    void appendTranscript(this.session.id, "user", line);
    void touchSession(this.session.id, line);

    try {
      await inngest.send({
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
    } catch (err) {
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
      case "help":
        this.tui.addMessage(
          "system",
          [
            "Commands:",
            "  /clear, /new   end this session and start a fresh one",
            "  /sessions      list known sessions",
            "  /help          show this help",
            "  /exit, /quit   quit",
            "",
            "Keys: Ctrl+C clear input (twice to exit) · Ctrl+L redraw · ↑/↓ history · PgUp/PgDn scroll",
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
    if (this.subscription) {
      try {
        this.subscription.close();
      } catch {
        /* best-effort */
      }
    }
    this.tui.stop();
    process.exit(0);
  }
}
