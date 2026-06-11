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

import { renderMarkdown } from "./markdown.ts";
import { InputReader, type Key } from "./input.ts";

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
  /** Cached rendered body lines — invalidated when content or width changes. */
  cache?: { width: number; content: string; lines: string[] };
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

/**
 * Hard-wrap a single line into fixed-width chunks (no word breaking). Used for
 * the input editor, where char-exact chunks keep the cursor math simple.
 * Returns at least one (possibly empty) chunk.
 */
function hardWrap(text: string, width: number): string[] {
  if (text.length === 0) return [""];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += width) out.push(text.slice(i, i + width));
  return out;
}

export class Tui {
  private messages: UiMessage[] = [];
  private input = "";
  private cursor = 0;
  private thinking = false;
  private thinkingSince = 0;
  private spinnerFrame = 0;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private scrollOffset = 0; // lines scrolled up from the bottom; 0 = pinned
  private lastTotalLines = 0; // transcript line count at last render, for scroll anchoring
  private viewHeight = 10; // transcript viewport height from last render, for page scrolling
  private history: string[] = [];
  private historyIndex = -1; // -1 = editing fresh input
  private draft = "";
  private exitArmed = false; // ctrl+c on empty input arms a second-press exit
  private statusHint = "";
  private input_: InputReader;

  constructor(
    private header: string,
    private cb: TuiCallbacks,
  ) {
    this.input_ = new InputReader({
      onKey: this.onKey,
      onText: (text) => this.insertText(text),
      onWheel: (dir) => this.scroll(dir === -1 ? 3 : -3),
    });
  }

  // --- lifecycle ---

  start(): void {
    process.stdout.write(ALT_SCREEN_ON + HIDE_CURSOR);
    this.input_.start();
    process.stdout.on("resize", this.render);
    this.render();
  }

  stop(): void {
    if (this.spinnerTimer) clearInterval(this.spinnerTimer);
    process.stdout.off("resize", this.render);
    this.input_.stop();
    process.stdout.write(SHOW_CURSOR + ALT_SCREEN_OFF);
  }

  /** Ring the terminal bell (e.g. when a run finishes). */
  bell(): void {
    process.stdout.write("\x07");
  }

  // --- public mutators (called by app on realtime / commands) ---

  setHeader(header: string): void {
    this.header = header;
    this.render();
  }

  addMessage(role: Role, content: string): void {
    this.messages.push({ role, content });
    // A line the user just typed snaps the view back to the bottom; agent and
    // system output respects an active scrollback position (see render()).
    if (role === "user") this.scrollOffset = 0;
    this.render();
  }

  /** Append text to the trailing assistant message, or start one. */
  appendAssistant(content: string): void {
    // Chunks from the model often carry leading/trailing newlines; rendering
    // those verbatim shows blank lines under the label, so normalize them.
    const text = content.trim();
    if (!text) return;
    const last = this.messages[this.messages.length - 1];
    if (last && last.role === "assistant") {
      last.content += "\n\n" + text;
    } else {
      this.messages.push({ role: "assistant", content: text });
    }
    this.render();
  }

  clearMessages(): void {
    this.messages = [];
    this.scrollOffset = 0;
    this.lastTotalLines = 0;
    this.render();
  }

  setThinking(thinking: boolean): void {
    if (thinking === this.thinking) return;
    this.thinking = thinking;
    if (thinking) {
      this.thinkingSince = Date.now();
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

  // --- key handling ---

  private onKey = (key: Key): void => {
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
    if (ctrl && name === "a") return this.moveCursor(this.lineStart());
    if (ctrl && name === "e") return this.moveCursor(this.lineEnd());

    // Shift+Enter (and Alt+Enter / Ctrl+J) insert a newline; plain Enter submits.
    if ((name === "return" || name === "enter") && (key.shift || key.meta)) {
      return this.insertText("\n");
    }

    switch (name) {
      case "return":
      case "enter":
        return this.submit();
      case "newline":
        return this.insertText("\n");
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
        return this.moveCursor(this.lineStart());
      case "end":
        return this.moveCursor(this.lineEnd());
      case "up":
        return this.onUp();
      case "down":
        return this.onDown();
      case "pageup":
        return this.scroll(Math.max(1, this.viewHeight - 1));
      case "pagedown":
        return this.scroll(-Math.max(1, this.viewHeight - 1));
    }
  };

  /** Insert printable / pasted text (newlines allowed) at the cursor. */
  private insertText(text: string): void {
    const clean = text.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
    if (!clean) return;
    this.input = this.input.slice(0, this.cursor) + clean + this.input.slice(this.cursor);
    this.cursor += clean.length;
    this.render();
  }

  private setInput(value: string, cursor: number): void {
    this.input = value;
    this.cursor = Math.max(0, Math.min(cursor, value.length));
    this.render();
  }

  private moveCursor(to: number, silent = false): void {
    this.cursor = Math.max(0, Math.min(to, this.input.length));
    if (!silent) this.render();
  }

  /** Offset of the start of the logical line the cursor is on. */
  private lineStart(): number {
    return this.input.lastIndexOf("\n", this.cursor - 1) + 1;
  }

  /** Offset of the end of the logical line the cursor is on. */
  private lineEnd(): number {
    const nl = this.input.indexOf("\n", this.cursor);
    return nl === -1 ? this.input.length : nl;
  }

  /** Up arrow: move up a line within multi-line input, else recall history. */
  private onUp(): void {
    const start = this.lineStart();
    if (start === 0) return this.recallHistory(-1);
    const col = this.cursor - start;
    const prevStart = this.input.lastIndexOf("\n", start - 2) + 1;
    const prevLen = start - 1 - prevStart;
    this.moveCursor(prevStart + Math.min(col, prevLen));
  }

  /** Down arrow: move down a line within multi-line input, else recall history. */
  private onDown(): void {
    const end = this.lineEnd();
    if (end === this.input.length) return this.recallHistory(1);
    const col = this.cursor - this.lineStart();
    const nextStart = end + 1;
    const nextEnd = this.input.indexOf("\n", nextStart);
    const nextLen = (nextEnd === -1 ? this.input.length : nextEnd) - nextStart;
    this.moveCursor(nextStart + Math.min(col, nextLen));
  }

  /** Scroll the transcript by `delta` lines (positive = back/up). */
  private scroll(delta: number): void {
    this.scrollOffset = Math.max(0, this.scrollOffset + delta);
    this.render();
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

    // The input grows with its content; cap it so the transcript keeps room.
    const maxInputRows = Math.max(1, Math.min(rows - 4, Math.max(3, Math.floor(rows / 3))));
    const input = this.renderInputBlock(cols, maxInputRows);
    const inputHeight = input.lines.length;

    // Layout: header (1), transcript, separator (1), status (1), input (inputHeight).
    const transcriptHeight = Math.max(1, rows - 3 - inputHeight);
    this.viewHeight = transcriptHeight;

    // Build all transcript lines.
    const lines: string[] = [];
    for (const msg of this.messages) {
      lines.push(this.label(msg.role));
      for (const bodyLine of this.renderBody(msg, contentWidth - 2)) {
        lines.push("  " + bodyLine);
      }
      lines.push("");
    }

    // When scrolled up, hold the viewport on the same content as new lines are
    // appended below (rather than letting it drift toward the bottom).
    if (this.scrollOffset > 0 && lines.length > this.lastTotalLines) {
      this.scrollOffset += lines.length - this.lastTotalLines;
    }
    this.lastTotalLines = lines.length;

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
    for (const l of input.lines) frame.push(l);

    // Cursor's terminal position: input block starts right after header +
    // transcript + separator + status.
    const inputStartRow = 1 + transcriptHeight + 1 + 1; // 0-based frame index
    const cursorRow = inputStartRow + input.cursorRow + 1; // 1-based terminal row
    const cursorCol = input.cursorCol;

    // Write the whole frame at once: home, then each line + erase-to-EOL.
    let out = HIDE_CURSOR + `${ESC}H`;
    out += frame.map((l) => l + `${ESC}K`).join("\r\n");
    out += `${ESC}J`; // clear anything below
    // Place the real cursor on the input line and reveal it.
    out += `${ESC}${cursorRow};${cursorCol}H` + SHOW_CURSOR;
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

  /**
   * Render a message body to wrapped lines, cached per (content, width).
   * Assistant text is rendered as markdown; user/system stay plain.
   */
  private renderBody(msg: UiMessage, width: number): string[] {
    if (msg.cache && msg.cache.width === width && msg.cache.content === msg.content) {
      return msg.cache.lines;
    }
    let lines: string[];
    if (msg.role === "assistant") {
      lines = renderMarkdown(msg.content, width);
    } else if (msg.role === "system") {
      lines = wrap(msg.content, width).map((l) => `${YELLOW}${l}${RESET}`);
    } else {
      lines = wrap(msg.content, width); // user: plain
    }
    msg.cache = { width, content: msg.content, lines };
    return lines;
  }

  private statusLine(cols: number): string {
    if (this.statusHint) {
      return this.truncate(`${MAGENTA}${this.statusHint}${RESET}`, cols);
    }
    if (this.thinking) {
      const secs = Math.floor((Date.now() - this.thinkingSince) / 1000);
      const elapsed = secs > 0 ? ` ${secs}s` : "";
      return this.truncate(
        `${CYAN}${SPINNER[this.spinnerFrame]} thinking…${elapsed}${RESET}`,
        cols,
      );
    }
    const hint =
      this.scrollOffset > 0
        ? "↑ scrolled — wheel/PgDn to return"
        : "/help for commands · Shift+Enter for newline";
    return this.truncate(`${DIM}${hint}${RESET}`, cols);
  }

  /**
   * Render the input buffer as a (possibly multi-line) block, returning the
   * physical lines plus where the cursor lands within them. Each logical line
   * (split on "\n") is hard-wrapped to the available width; the prompt "❯ "
   * leads the first row and continuation rows are indented to match. If the
   * block is taller than `maxRows`, a window around the cursor is shown.
   */
  private renderInputBlock(
    cols: number,
    maxRows: number,
  ): { lines: string[]; cursorRow: number; cursorCol: number } {
    const promptWidth = 2; // "❯ " / "  "
    const width = Math.max(1, cols - promptWidth);

    const logical = this.input.split("\n");
    const rows: string[] = [];
    let cursorRow = 0;
    let cursorCol = promptWidth + 1;
    let consumed = 0; // chars before the start of the current logical line

    for (const text of logical) {
      const chunks = hardWrap(text, width);
      const firstRow = rows.length;
      for (const chunk of chunks) rows.push(chunk);

      // Is the cursor inside this logical line? (inclusive of its end)
      if (this.cursor >= consumed && this.cursor <= consumed + text.length) {
        const off = this.cursor - consumed;
        const chunkIdx = Math.min(Math.floor(off / width), chunks.length - 1);
        cursorRow = firstRow + chunkIdx;
        cursorCol = promptWidth + (off - chunkIdx * width) + 1;
      }
      consumed += text.length + 1; // + the "\n"
    }

    // Window the rows so the cursor row stays visible.
    let top = 0;
    if (rows.length > maxRows) {
      top = Math.max(0, Math.min(cursorRow - maxRows + 1, rows.length - maxRows));
      if (cursorRow < top) top = cursorRow;
    }
    const windowRows = rows.slice(top, top + Math.min(maxRows, rows.length));

    const lines = windowRows.map((row, idx) => {
      const lead = top + idx === 0 ? `${GREEN}❯ ${RESET}` : "  ";
      return lead + row;
    });
    if (lines.length === 0) lines.push(`${GREEN}❯ ${RESET}`);

    return { lines, cursorRow: cursorRow - top, cursorCol };
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
