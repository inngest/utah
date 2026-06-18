/**
 * Raw stdin decoder for the TUI.
 *
 * Why not `readline.emitKeypressEvents`? Shift+Enter for a newline is reported
 * as CSI-u (`\x1b[13;2u`) or xterm "modifyOtherKeys" (`\x1b[27;2;13~`), neither
 * of which readline understands — it would leak those byte sequences into the
 * input as garbage text. So we own the decode loop: enable bracketed-paste +
 * modifyOtherKeys, and translate raw chunks into key / text events. Partial
 * escape sequences split across chunks are buffered until they complete.
 *
 * Note: we deliberately do NOT enable mouse tracking. The transcript lives in
 * the terminal's normal scrollback (see ui.ts), so selection, copy, link
 * ⌘-click, and wheel scrolling are all handled natively by the terminal —
 * capturing the mouse would only break them.
 */

/** A decoded key event. `name` is undefined for plain printable text (which is delivered via onText instead). */
export interface Key {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence: string;
}

export interface InputHandlers {
  /** A non-printable / named key (arrows, enter, ctrl-combos, …). */
  onKey: (key: Key) => void;
  /** Printable input — typed runs and pasted text (may contain newlines). */
  onText: (text: string) => void;
}

// Terminal modes we turn on for the session (and must turn back off on exit):
//   ?2004h  — bracketed paste (pasted text wrapped in \x1b[200~ … \x1b[201~)
//   >4;1m   — modifyOtherKeys=1 so Shift+Enter is distinguishable from Enter
const ENABLE = "\x1b[?2004h\x1b[>4;1m";
export const DISABLE = "\x1b[?2004l\x1b[>4m";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

export class InputReader {
  /** Accumulated paste body while between the start/end markers; null when not pasting. */
  private paste: string | null = null;
  /** A dangling, not-yet-complete escape sequence carried to the next chunk. */
  private pending = "";

  constructor(private h: InputHandlers) {}

  start(): void {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdout.write(ENABLE);
    process.stdin.resume();
    process.stdin.on("data", this.onData);
  }

  stop(): void {
    process.stdin.off("data", this.onData);
    process.stdout.write(DISABLE);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
  }

  private onData = (chunk: string): void => {
    const s = this.pending + chunk;
    this.pending = "";
    this.feed(s);
  };

  private feed(s: string): void {
    let i = 0;
    while (i < s.length) {
      // Inside a bracketed paste: swallow everything up to the end marker.
      if (this.paste !== null) {
        const end = s.indexOf(PASTE_END, i);
        if (end === -1) {
          // Keep a tail that might be a split end marker for the next chunk.
          const keep = tailMatchLen(s, PASTE_END, i);
          this.paste += s.slice(i, s.length - keep);
          this.pending = s.slice(s.length - keep);
          return;
        }
        this.paste += s.slice(i, end);
        this.h.onText(this.paste);
        this.paste = null;
        i = end + PASTE_END.length;
        continue;
      }

      const c = s[i];
      if (c === "\x1b") {
        const consumed = this.parseEscape(s, i);
        if (consumed > 0) {
          i += consumed;
          continue;
        }
        // Couldn't parse it. If it looks like a truncated sequence, buffer the
        // tail for the next chunk; otherwise treat it as a bare Escape.
        const tail = s.slice(i);
        if (looksIncomplete(tail)) {
          this.pending = tail;
          return;
        }
        this.h.onKey({ name: "escape", sequence: "\x1b" });
        i += 1;
        continue;
      }

      const code = c.charCodeAt(0);
      if (code === 0x0d) {
        this.h.onKey({ name: "return", sequence: c }); // Enter → submit
      } else if (code === 0x0a) {
        this.h.onKey({ name: "newline", sequence: c }); // Ctrl+J → newline
      } else if (code === 0x09) {
        this.h.onKey({ name: "tab", sequence: c });
      } else if (code === 0x7f || code === 0x08) {
        this.h.onKey({ name: "backspace", sequence: c });
      } else if (code < 0x20) {
        // Other control chars → Ctrl+<letter> (0x01 → 'a', 0x03 → 'c', …).
        this.h.onKey({ name: String.fromCharCode(code + 96), ctrl: true, sequence: c });
      } else {
        // A run of printable characters (fast typing, or a non-bracketed paste).
        let j = i;
        while (j < s.length && s.charCodeAt(j) >= 0x20 && s[j] !== "\x1b") j++;
        this.h.onText(s.slice(i, j));
        i = j;
        continue;
      }
      i += 1;
    }
  }

  /** Parse an escape sequence at `s[i]`. Returns chars consumed, or 0 if unrecognized/incomplete. */
  private parseEscape(s: string, i: number): number {
    const rest = s.slice(i);

    if (rest.startsWith(PASTE_START)) {
      this.paste = "";
      return PASTE_START.length;
    }

    // Alt/Shift+Enter on some terminals: ESC then CR/LF → treat as a newline.
    if (rest.startsWith("\x1b\r") || rest.startsWith("\x1b\n")) {
      this.h.onKey({ name: "newline", meta: true, sequence: rest.slice(0, 2) });
      return 2;
    }

    if (rest.startsWith("\x1b[")) {
      // Generic CSI: \x1b[ <params> <final>.
      const csi = /^\x1b\[([0-9;:]*)([~A-Za-z])/.exec(rest);
      if (csi) {
        this.h.onKey(csiToKey(csi[1], csi[2], csi[0]));
        return csi[0].length;
      }
      return 0; // incomplete CSI
    }

    // SS3 (application cursor mode): \x1bO<letter>.
    const ss3 = /^\x1bO([A-Za-z])/.exec(rest);
    if (ss3) {
      this.h.onKey({ name: LETTER_KEYS[ss3[1]], sequence: ss3[0] });
      return ss3[0].length;
    }

    // Meta + single printable char (e.g. Alt+f).
    if (rest.length >= 2 && rest[1] !== "\x1b" && rest.charCodeAt(1) >= 0x20) {
      this.h.onKey({ name: rest[1].toLowerCase(), meta: true, sequence: rest.slice(0, 2) });
      return 2;
    }

    return 0;
  }
}

const LETTER_KEYS: Record<string, string> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
};

const TILDE_KEYS: Record<number, string> = {
  1: "home",
  2: "insert",
  3: "delete",
  4: "end",
  5: "pageup",
  6: "pagedown",
  7: "home",
  8: "end",
};

/** Decode an xterm modifier param (1 + bitmask) into ctrl/meta/shift flags. */
function decodeMods(param?: string): { shift: boolean; meta: boolean; ctrl: boolean } {
  const n = param ? parseInt(param, 10) : 1;
  const bits = (Number.isNaN(n) ? 1 : n) - 1;
  return { shift: !!(bits & 1), meta: !!(bits & 2), ctrl: !!(bits & 4) };
}

function csiToKey(params: string, final: string, seq: string): Key {
  const parts = params.split(";");

  // CSI-u: <code>;<mod> u  (e.g. 13;2u = Shift+Enter).
  if (final === "u") {
    const code = parseInt(parts[0] || "0", 10);
    const mods = decodeMods(parts[1]);
    return keyForCode(code, mods, seq);
  }

  // Tilde finals, including modifyOtherKeys (27;<mod>;<code>~).
  if (final === "~") {
    if (parts[0] === "27" && parts.length >= 3) {
      const code = parseInt(parts[2] || "0", 10);
      return keyForCode(code, decodeMods(parts[1]), seq);
    }
    const n = parseInt(parts[0] || "0", 10);
    return { name: TILDE_KEYS[n], ...decodeMods(parts[1]), sequence: seq };
  }

  // Letter finals: arrows and home/end, possibly with a modifier (e.g. 1;5C).
  return { name: LETTER_KEYS[final], ...decodeMods(parts[1]), sequence: seq };
}

/** Map a raw key code (from CSI-u / modifyOtherKeys) to a Key. */
function keyForCode(
  code: number,
  mods: { shift: boolean; meta: boolean; ctrl: boolean },
  seq: string,
): Key {
  if (code === 13)
    return { name: mods.shift || mods.meta ? "newline" : "return", ...mods, sequence: seq };
  if (code === 9) return { name: "tab", ...mods, sequence: seq };
  if (code === 127 || code === 8) return { name: "backspace", ...mods, sequence: seq };
  return { name: String.fromCharCode(code).toLowerCase(), ...mods, sequence: seq };
}

/** True when `t` could be the truncated start of a longer escape sequence. */
function looksIncomplete(t: string): boolean {
  if (t === "\x1b" || t === "\x1bO") return true;
  if (/^\x1b\[[0-9;:<]*$/.test(t)) return true; // CSI awaiting its final byte
  return false;
}

/** Length of the longest suffix of `s` (from `from`) that is a proper prefix of `needle`. */
function tailMatchLen(s: string, needle: string, from: number): number {
  const max = Math.min(needle.length - 1, s.length - from);
  for (let len = max; len > 0; len--) {
    if (needle.startsWith(s.slice(s.length - len))) return len;
  }
  return 0;
}
