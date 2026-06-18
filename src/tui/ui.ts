/**
 * Inline terminal UI: a transcript that flows into the terminal's normal
 * scrollback, with a live input prompt pinned to the bottom.
 *
 * No TUI framework — the project runs TypeScript directly via Node's type
 * stripping, which does not transform JSX, so ink/React are out. This is a
 * self-contained renderer built on raw-mode keypress events and ANSI escapes.
 *
 * Rendering model (the same one Claude Code uses): rather than owning the whole
 * screen via the alternate buffer, finished messages are *committed* — printed
 * once to the normal terminal buffer, where they become permanent scrollback.
 * That hands scrolling, text selection, copy, link ⌘-click, and terminal search
 * back to the terminal, which does them far better than we could. Only a small
 * "live region" (the input editor + a status line) is redrawn in place at the
 * bottom: to update it we move the cursor up to its top, clear to end of screen,
 * and rewrite it. To commit a message we erase the live region, print the
 * message where it stood, then redraw the live region below it.
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

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export type Role = "user" | "assistant" | "system";

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
  private input = "";
  private cursor = 0;
  private thinking = false;
  private thinkingSince = 0;
  private spinnerFrame = 0;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private history: string[] = [];
  private historyIndex = -1; // -1 = editing fresh input
  private draft = "";
  private exitArmed = false; // ctrl+c on empty input arms a second-press exit
  private statusHint = "";
  private input_: InputReader;

  // Live-region bookkeeping. The live region is the input + status line drawn at
  // the bottom; everything above it is committed scrollback we never touch again.
  private liveRows = 0; // physical rows the live region occupied at last draw
  private liveCaretRow = 0; // caret's row offset from the top of the live region
  // Whether an assistant turn is "open" — its label has been printed and further
  // streamed segments append under it without repeating the label.
  private turnOpen = false;

  constructor(
    private header: string,
    private cb: TuiCallbacks,
  ) {
    this.input_ = new InputReader({
      onKey: this.onKey,
      onText: (text) => this.insertText(text),
    });
  }

  // --- lifecycle ---

  start(): void {
    this.input_.start();
    process.stdout.on("resize", this.render);
    this.render(); // draw the initial (empty) prompt
  }

  stop(): void {
    if (this.spinnerTimer) clearInterval(this.spinnerTimer);
    process.stdout.off("resize", this.render);
    this.input_.stop();
    // Erase the live region so the shell prompt lands cleanly under the
    // transcript, then leave the cursor on a fresh line.
    process.stdout.write(HIDE_CURSOR + this.clearLiveSeq() + "\r\n" + SHOW_CURSOR);
    this.liveRows = 0;
  }

  /** Ring the terminal bell (e.g. when a run finishes). */
  bell(): void {
    process.stdout.write("\x07");
  }

  // --- public mutators (called by app on realtime / commands) ---

  setHeader(header: string): void {
    this.header = header;
    this.commit([`${BOLD}${CYAN} ${header}${RESET}`, ""]);
  }

  addMessage(role: Role, content: string): void {
    // A fresh user line starts a new turn; the next assistant text reprints its label.
    if (role === "user") this.turnOpen = false;
    this.commit(this.messageBlock(role, content));
  }

  /** Append a streamed assistant segment, printing the label once per turn. */
  appendAssistant(content: string): void {
    // Chunks from the model often carry leading/trailing newlines; rendering
    // those verbatim shows blank lines under the label, so normalize them.
    const text = content.trim();
    if (!text) return;
    const width = this.contentWidth();
    const block: string[] = [];
    if (!this.turnOpen) {
      block.push(this.label("assistant"));
      this.turnOpen = true;
    }
    for (const line of renderMarkdown(text, width)) block.push("  " + line);
    block.push("");
    this.commit(block);
  }

  /** /clear: wipe the screen and scrollback for a clean slate. */
  clearMessages(): void {
    this.turnOpen = false;
    this.liveRows = 0;
    this.liveCaretRow = 0;
    // Home, clear screen, clear scrollback (3J), then redraw the prompt at top.
    process.stdout.write(`${ESC}H${ESC}2J${ESC}3J`);
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
      // PageUp/PageDown intentionally fall through to the terminal, which scrolls
      // its own scrollback — the transcript lives there now.
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

  private moveCursor(to: number): void {
    this.cursor = Math.max(0, Math.min(to, this.input.length));
    this.render();
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

  private contentWidth(): number {
    const cols = process.stdout.columns || 80;
    return Math.max(20, cols - 2) - 2; // page margin, then the "  " body indent
  }

  /** Build the committed lines for a finished message: a label then its body. */
  private messageBlock(role: Role, content: string): string[] {
    const width = this.contentWidth();
    const body =
      role === "assistant"
        ? renderMarkdown(content, width)
        : role === "system"
          ? wrap(content, width).map((l) => `${YELLOW}${l}${RESET}`)
          : wrap(content, width);
    return [this.label(role), ...body.map((l) => "  " + l), ""];
  }

  /**
   * Print a block of lines to the normal terminal buffer (permanent scrollback),
   * then redraw the live region below it. Erases the current live region first
   * so the block lands where the prompt stood.
   */
  private commit(block: string[]): void {
    let out = HIDE_CURSOR + this.clearLiveSeq();
    // After clearLiveSeq the cursor sits at column 0 where the live region began.
    out += "\r" + block.map((l) => l + `${ESC}K`).join("\r\n");
    if (block.length) out += "\r\n";
    this.liveRows = 0;
    this.liveCaretRow = 0;
    out += this.drawRegionSeq() + SHOW_CURSOR;
    process.stdout.write(out);
  }

  /** Redraw the live region in place (input + status). */
  private render = (): void => {
    process.stdout.write(HIDE_CURSOR + this.clearLiveSeq() + this.drawRegionSeq() + SHOW_CURSOR);
  };

  /**
   * Escape sequence that erases the current live region, leaving the cursor at
   * column 0 of the row where the region began (ready to draw or commit there).
   */
  private clearLiveSeq(): string {
    if (this.liveRows === 0) return "";
    let s = "";
    if (this.liveCaretRow > 0) s += `${ESC}${this.liveCaretRow}A`; // up to the region's top row
    s += "\r" + `${ESC}0J`; // column 0, then clear to end of screen
    return s;
  }

  /**
   * Escape sequence that draws the live region at the cursor's current row and
   * leaves the cursor at the input caret. Updates liveRows / liveCaretRow.
   */
  private drawRegionSeq(): string {
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    // Let the input grow, but never so tall that the live region can't fit on
    // screen (we move the cursor relative to its top, which must stay visible).
    const maxInputRows = Math.max(
      1,
      Math.min(Math.max(1, rows - 2), Math.max(3, Math.floor(rows / 3))),
    );
    const input = this.renderInputBlock(cols, maxInputRows);
    const region = [...input.lines, this.statusLine(cols)];

    const caretRow = input.cursorRow;
    const caretCol = input.cursorCol;
    let s = "\r" + region.map((l) => l + `${ESC}K`).join("\r\n");
    // Cursor is now at the end of the last region row; move it to the caret.
    const lastRow = region.length - 1;
    if (lastRow > caretRow) s += `${ESC}${lastRow - caretRow}A`;
    s += `${ESC}${caretCol}G`; // absolute column

    this.liveRows = region.length;
    this.liveCaretRow = caretRow;
    return s;
  }

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
    return this.truncate(`${DIM}/help for commands · Shift+Enter for newline${RESET}`, cols);
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
  private truncate(s: string, max: number): string {
    // We assume our own strings have balanced codes; budget by stripped length.
    const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
    if (stripped.length <= max) return s;
    // Rare path (very narrow terminals): fall back to stripped truncation.
    return stripped.slice(0, max);
  }
}
