/**
 * Full-screen terminal UI: a scrolling transcript with a fixed input line.
 *
 * No TUI framework — the project runs TypeScript directly via Node's type
 * stripping, which does not transform JSX, so ink/React are out. This is a
 * self-contained renderer built on raw-mode keypress events and ANSI escapes.
 *
 * Each render builds the entire frame and writes it in a single call, clearing
 * each line as it goes (cursor-home + erase-line) rather than clearing the
 * whole screen, which keeps the spinner from flickering.
 */

import readline from "node:readline";

// --- ANSI helpers ---
const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const DIM = `${ESC}2m`;
const BOLD = `${ESC}1m`;
const CYAN = `${ESC}36m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const MAGENTA = `${ESC}35m`;
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const ALT_SCREEN_ON = `${ESC}?1049h`;
const ALT_SCREEN_OFF = `${ESC}?1049l`;

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export type Role = "user" | "assistant" | "system";
export interface UiMessage {
  role: Role;
  content: string;
}

export interface TuiCallbacks {
  /** A submitted line (already trimmed of trailing newline). May be a /command. */
  onSubmit: (line: string) => void;
  /** Ctrl+C / Ctrl+D requested exit. */
  onExit: () => void;
}

/** Wrap a block of text (which may contain newlines) to a max width. */
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (rawLine.length === 0) {
      out.push("");
      continue;
    }
    let line = rawLine;
    while (line.length > width) {
      // Prefer breaking at the last space within the width window.
      let breakAt = line.lastIndexOf(" ", width);
      if (breakAt <= 0) breakAt = width;
      out.push(line.slice(0, breakAt));
      line = line.slice(breakAt).replace(/^ /, "");
    }
    out.push(line);
  }
  return out;
}

export class Tui {
  private messages: UiMessage[] = [];
  private input = "";
  private cursor = 0;
  private thinking = false;
  private spinnerFrame = 0;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private scrollOffset = 0; // lines scrolled up from the bottom; 0 = pinned
  private history: string[] = [];
  private historyIndex = -1; // -1 = editing fresh input
  private draft = "";
  private exitArmed = false; // ctrl+c on empty input arms a second-press exit
  private statusHint = "";
  private rl: readline.Interface | null = null;

  constructor(
    private header: string,
    private cb: TuiCallbacks,
  ) {}

  // --- lifecycle ---

  start(): void {
    process.stdout.write(ALT_SCREEN_ON + HIDE_CURSOR);
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", this.onKeypress);
    process.stdout.on("resize", this.render);
    this.render();
  }

  stop(): void {
    if (this.spinnerTimer) clearInterval(this.spinnerTimer);
    process.stdin.off("keypress", this.onKeypress);
    process.stdout.off("resize", this.render);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(SHOW_CURSOR + ALT_SCREEN_OFF);
  }

  // --- public mutators (called by app on realtime / commands) ---

  setHeader(header: string): void {
    this.header = header;
    this.render();
  }

  addMessage(role: Role, content: string): void {
    this.messages.push({ role, content });
    this.scrollOffset = 0;
    this.render();
  }

  /** Append text to the trailing assistant message, or start one. */
  appendAssistant(content: string): void {
    const last = this.messages[this.messages.length - 1];
    if (last && last.role === "assistant") {
      last.content += (last.content ? "\n\n" : "") + content;
    } else {
      this.messages.push({ role: "assistant", content });
    }
    this.scrollOffset = 0;
    this.render();
  }

  clearMessages(): void {
    this.messages = [];
    this.scrollOffset = 0;
    this.render();
  }

  setThinking(thinking: boolean): void {
    if (thinking === this.thinking) return;
    this.thinking = thinking;
    if (thinking) {
      this.spinnerTimer = setInterval(() => {
        this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER.length;
        this.render();
      }, 80);
    } else if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    this.render();
  }

  // --- keypress handling ---

  private onKeypress = (str: string | undefined, key: readline.Key): void => {
    if (!key) return;
    const ctrl = key.ctrl === true;
    const name = key.name;

    // Ctrl+C: clear the input; on an already-empty line, a second press exits.
    if (ctrl && name === "c") {
      if (this.input.length > 0) {
        this.setInput("", 0);
        this.exitArmed = false;
        this.statusHint = "";
      } else if (this.exitArmed) {
        this.cb.onExit();
      } else {
        this.exitArmed = true;
        this.statusHint = "press ctrl+c again to exit";
      }
      this.render();
      return;
    }
    // Any other key disarms the exit prompt.
    this.exitArmed = false;
    this.statusHint = "";

    if (ctrl && name === "d") return this.cb.onExit();
    if (ctrl && name === "l") return this.render();
    if (ctrl && name === "u") return this.setInput("", 0);
    if (ctrl && name === "a") return this.moveCursor(0, true);
    if (ctrl && name === "e") return this.moveCursor(this.input.length, true);

    switch (name) {
      case "return":
      case "enter":
        return this.submit();
      case "backspace":
        if (this.cursor > 0) {
          this.setInput(
            this.input.slice(0, this.cursor - 1) + this.input.slice(this.cursor),
            this.cursor - 1,
          );
        }
        return;
      case "delete":
        this.setInput(
          this.input.slice(0, this.cursor) + this.input.slice(this.cursor + 1),
          this.cursor,
        );
        return;
      case "left":
        return this.moveCursor(this.cursor - 1);
      case "right":
        return this.moveCursor(this.cursor + 1);
      case "home":
        return this.moveCursor(0);
      case "end":
        return this.moveCursor(this.input.length);
      case "up":
        return this.recallHistory(-1);
      case "down":
        return this.recallHistory(1);
      case "pageup":
        this.scrollOffset += 5;
        return this.render();
      case "pagedown":
        this.scrollOffset = Math.max(0, this.scrollOffset - 5);
        return this.render();
    }

    // Printable input (including pasted runs). Reject control characters.
    if (str && !ctrl && !key.meta && !/[\x00-\x1f]/.test(str)) {
      this.setInput(
        this.input.slice(0, this.cursor) + str + this.input.slice(this.cursor),
        this.cursor + str.length,
      );
    }
  };

  private setInput(value: string, cursor: number): void {
    this.input = value;
    this.cursor = Math.max(0, Math.min(cursor, value.length));
    this.render();
  }

  private moveCursor(to: number, silent = false): void {
    this.cursor = Math.max(0, Math.min(to, this.input.length));
    if (!silent) this.render();
  }

  private recallHistory(dir: -1 | 1): void {
    if (this.history.length === 0) return;
    if (this.historyIndex === -1) {
      if (dir === 1) return; // already at fresh input
      this.draft = this.input;
      this.historyIndex = this.history.length - 1;
    } else {
      this.historyIndex += dir;
    }
    if (this.historyIndex >= this.history.length) {
      this.historyIndex = -1;
      this.setInput(this.draft, this.draft.length);
      return;
    }
    this.historyIndex = Math.max(0, this.historyIndex);
    const value = this.history[this.historyIndex];
    this.setInput(value, value.length);
  }

  private submit(): void {
    const line = this.input.trim();
    if (line.length === 0) {
      this.setInput("", 0);
      return;
    }
    this.history.push(this.input);
    this.historyIndex = -1;
    this.draft = "";
    const value = this.input;
    this.input = "";
    this.cursor = 0;
    this.cb.onSubmit(value.trim());
  }

  // --- rendering ---

  private render = (): void => {
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    const contentWidth = Math.max(20, cols - 2);

    // Layout: header (1), transcript (rows-4), separator (1), status (1), input (1)
    const transcriptHeight = Math.max(1, rows - 4);

    // Build all transcript lines.
    const lines: string[] = [];
    for (const msg of this.messages) {
      lines.push(this.label(msg.role));
      for (const wrapped of wrap(msg.content, contentWidth - 2)) {
        lines.push("  " + this.colorBody(msg.role, wrapped));
      }
      lines.push("");
    }

    // Viewport: show the tail, honoring scrollOffset (clamped).
    const maxOffset = Math.max(0, lines.length - transcriptHeight);
    this.scrollOffset = Math.min(this.scrollOffset, maxOffset);
    const end = lines.length - this.scrollOffset;
    const start = Math.max(0, end - transcriptHeight);
    const visible = lines.slice(start, end);
    while (visible.length < transcriptHeight) visible.unshift(""); // top-pad

    // Compose the frame.
    const frame: string[] = [];
    frame.push(this.truncate(`${BOLD}${CYAN} ${this.header}${RESET}`, cols, true));
    for (const l of visible) frame.push(l);
    frame.push(`${DIM}${"─".repeat(cols)}${RESET}`);
    frame.push(this.statusLine(cols));

    const { line: inputLine, cursorCol } = this.inputLine(cols);
    frame.push(inputLine);

    // Write the whole frame at once: home, then each line + erase-to-EOL.
    let out = HIDE_CURSOR + `${ESC}H`;
    out += frame.map((l) => l + `${ESC}K`).join("\r\n");
    out += `${ESC}J`; // clear anything below
    // Place the real cursor on the input line and reveal it.
    out += `${ESC}${rows};${cursorCol}H` + SHOW_CURSOR;
    process.stdout.write(out);
  };

  private label(role: Role): string {
    switch (role) {
      case "user":
        return `${DIM}you${RESET}`;
      case "assistant":
        return `${GREEN}${BOLD}utah${RESET}`;
      case "system":
        return `${YELLOW}system${RESET}`;
    }
  }

  private colorBody(role: Role, text: string): string {
    if (role === "system") return `${YELLOW}${text}${RESET}`;
    if (role === "user") return text;
    return text; // assistant: default fg
  }

  private statusLine(cols: number): string {
    if (this.statusHint) {
      return this.truncate(`${MAGENTA}${this.statusHint}${RESET}`, cols);
    }
    if (this.thinking) {
      return this.truncate(`${CYAN}${SPINNER[this.spinnerFrame]} thinking…${RESET}`, cols);
    }
    const hint = this.scrollOffset > 0 ? "↑ scrolled — PgDn to return" : "/help for commands";
    return this.truncate(`${DIM}${hint}${RESET}`, cols);
  }

  private inputLine(cols: number): { line: string; cursorCol: number } {
    const prompt = `${GREEN}❯ ${RESET}`;
    const promptWidth = 2; // "❯ "
    const avail = Math.max(1, cols - promptWidth);
    const startIdx = this.cursor < avail ? 0 : this.cursor - avail + 1;
    const visible = this.input.slice(startIdx, startIdx + avail);
    const cursorCol = promptWidth + (this.cursor - startIdx) + 1; // 1-based column
    return { line: prompt + visible, cursorCol };
  }

  /** Truncate a (possibly ANSI-colored) string to a visible width budget. */
  private truncate(s: string, max: number, padReset = false): string {
    // We assume our own strings have balanced codes; budget by stripped length.
    const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
    if (stripped.length <= max) return s;
    // Rare path (very narrow terminals): fall back to stripped truncation.
    return stripped.slice(0, max) + (padReset ? RESET : "");
  }
}
