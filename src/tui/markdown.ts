/**
 * Tiny markdown → ANSI renderer for the terminal.
 *
 * Returns an array of *already-wrapped* physical lines for a given width, so it
 * drops straight into the TUI's line-based viewport. Each emitted line ends
 * with a reset, so styles never bleed into the input line below.
 *
 * Why not a library (marked-terminal / cli-markdown)? They pull in a large
 * dependency tree (chalk, cli-highlight → highlight.js, cli-table3) and emit
 * pre-styled ANSI that conflicts with this renderer's own width-aware
 * wrapping. This covers the constructs an agent actually emits in chat:
 * headings, bold/italic/strikethrough, inline code, fenced code blocks,
 * bullet/numbered lists, blockquotes, links, and horizontal rules.
 */

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const ITALIC = `${ESC}3m`;
const UNDERLINE = `${ESC}4m`;
const STRIKE = `${ESC}9m`;
const CYAN = `${ESC}36m`;
const BLUE = `${ESC}34m`;
const YELLOW = `${ESC}33m`;
const GRAY = `${ESC}90m`;

// --- inline parsing ---

interface Style {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: boolean;
  dim?: boolean;
  color?: string;
}

interface Run {
  text: string;
  style: Style;
}

interface InlineRule {
  re: RegExp;
  apply: keyof Style;
  recurse: boolean;
}

// Order matters only for ties at the same index; we always take the earliest
// match. Bold (`**`) is listed before italic (`*`) so it wins at equal index.
const INLINE_RULES: InlineRule[] = [
  { re: /`([^`]+)`/, apply: "code", recurse: false },
  { re: /\*\*([^*]+?)\*\*/, apply: "bold", recurse: true },
  { re: /(?<![A-Za-z0-9])__([^_]+?)__(?![A-Za-z0-9])/, apply: "bold", recurse: true },
  { re: /~~([^~]+?)~~/, apply: "strike", recurse: true },
  { re: /\*([^*\n]+?)\*/, apply: "italic", recurse: true },
  { re: /(?<![A-Za-z0-9])_([^_\n]+?)_(?![A-Za-z0-9])/, apply: "italic", recurse: true },
];

const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/;

/** Parse inline markdown into styled runs, inheriting a base style. */
function parseInline(text: string, base: Style): Run[] {
  if (!text) return [];
  // Inside a code span there is no further markdown.
  if (base.code) return [{ text, style: base }];

  let best: { index: number; len: number; inner: string; style: Style; recurse: boolean } | null =
    null;

  for (const rule of INLINE_RULES) {
    const m = rule.re.exec(text);
    if (m && (best === null || m.index < best.index)) {
      best = {
        index: m.index,
        len: m[0].length,
        inner: m[1],
        style: { ...base, [rule.apply]: true },
        recurse: rule.recurse,
      };
    }
  }
  const link = LINK_RE.exec(text);
  if (link && (best === null || link.index < best.index)) {
    best = {
      index: link.index,
      len: link[0].length,
      inner: link[1],
      style: { ...base, link: true },
      recurse: false,
    };
  }

  if (!best) return [{ text, style: base }];

  const runs: Run[] = [];
  if (best.index > 0) runs.push({ text: text.slice(0, best.index), style: base });
  if (best.recurse) {
    runs.push(...parseInline(best.inner, best.style));
  } else {
    runs.push({ text: best.inner, style: best.style });
  }
  runs.push(...parseInline(text.slice(best.index + best.len), base));
  return runs;
}

function codesFor(s: Style): string {
  if (s.code) return YELLOW; // code spans render monochrome-ish, no other styling
  let c = "";
  if (s.dim) c += DIM;
  if (s.bold) c += BOLD;
  if (s.italic) c += ITALIC;
  if (s.strike) c += STRIKE;
  if (s.link) c += UNDERLINE + BLUE;
  if (s.color) c += s.color;
  return c;
}

/** Lay styled runs into wrapped physical lines of at most `width` columns. */
function layout(runs: Run[], width: number): string[] {
  const w = Math.max(4, width);

  // Tokenize across all runs. `glued` marks a word that directly abuts the
  // previous one with no whitespace between them (e.g. emphasis followed by
  // punctuation) so we don't insert a stray space at the run boundary.
  const tokens: { word: string; style: Style; glued: boolean }[] = [];
  let lastWasWord = false;
  for (const run of runs) {
    for (const piece of run.text.split(/(\s+)/)) {
      if (piece === "") continue;
      if (/^\s+$/.test(piece)) {
        lastWasWord = false;
        continue;
      }
      tokens.push({ word: piece, style: run.style, glued: lastWasWord });
      lastWasWord = true;
    }
  }
  if (tokens.length === 0) return [""];

  const lines: string[] = [];
  let out = "";
  let len = 0;

  const flush = () => {
    lines.push(out + RESET);
    out = "";
    len = 0;
  };

  for (const t of tokens) {
    let word = t.word;
    const codes = codesFor(t.style);
    // Hard-break words longer than the line (e.g. long URLs).
    while (word.length > w) {
      if (len > 0) flush();
      lines.push(codes + word.slice(0, w) + RESET);
      word = word.slice(w);
    }
    const space = len > 0 && !t.glued ? 1 : 0;
    if (len > 0 && len + space + word.length > w) flush();
    if (len > 0 && !t.glued) {
      out += " ";
      len += 1;
    }
    out += codes + word + RESET;
    len += word.length;
  }
  if (len > 0) flush();
  return lines;
}

// --- block parsing ---

const FENCE_RE = /^\s*```/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const LIST_RE = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;

/** Render markdown to wrapped ANSI lines for the given column width. */
export function renderMarkdown(md: string, width: number): string[] {
  const w = Math.max(8, width);
  const src = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  for (let i = 0; i < src.length; ) {
    const line = src[i];

    // Fenced code block.
    if (FENCE_RE.test(line)) {
      i++;
      while (i < src.length && !FENCE_RE.test(src[i])) {
        let code = src[i];
        if (code.length === 0) out.push("");
        while (code.length > w) {
          out.push(GRAY + code.slice(0, w) + RESET);
          code = code.slice(w);
        }
        out.push(GRAY + code + RESET);
        i++;
      }
      i++; // skip closing fence
      continue;
    }

    if (line.trim() === "") {
      out.push("");
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      out.push(DIM + "─".repeat(w) + RESET);
      i++;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      out.push(...layout(parseInline(heading[2], { bold: true, color: CYAN }), w));
      i++;
      continue;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      const body = layout(parseInline(quote[1], { dim: true }), w - 2);
      for (const l of body) out.push(`${DIM}│${RESET} ${l}`);
      i++;
      continue;
    }

    const list = LIST_RE.exec(line);
    if (list) {
      const indent = list[1].length;
      const ordered = /^\d+\./.test(list[2]);
      const marker = ordered ? list[2] : "•";
      const prefixWidth = marker.length + 1;
      const body = layout(parseInline(list[3], {}), w - indent - prefixWidth);
      const pad = " ".repeat(indent);
      body.forEach((l, idx) => {
        const lead = idx === 0 ? `${CYAN}${marker}${RESET} ` : " ".repeat(prefixWidth);
        out.push(pad + lead + l);
      });
      i++;
      continue;
    }

    // Plain paragraph line.
    out.push(...layout(parseInline(line, {}), w));
    i++;
  }

  return out;
}
