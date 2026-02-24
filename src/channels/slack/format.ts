/**
 * Markdown and text formatting for Slack.
 *
 * Converts agent response markdown to Slack's mrkdwn format,
 * handles message splitting, and provides fallbacks.
 */

/**
 * Convert markdown to Slack's mrkdwn format.
 * Slack uses a subset of markdown with some quirks.
 */
export function markdownToSlackMrkdwn(text: string): string {
  return text
    // Bold: **text** or __text__ -> *text*
    .replace(/\*\*(.*?)\*\*/g, "*$1*")
    .replace(/__(.*?)__/g, "*$1*")
    
    // Italic: *text* or _text_ -> _text_
    .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, "_$1_")
    
    // Code: `text` -> `text` (already correct)
    // Code blocks: ```text``` -> ```text``` (already correct)
    
    // Links: [text](url) -> <url|text>
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>")
    
    // Strikethrough: ~~text~~ -> ~text~
    .replace(/~~(.*?)~~/g, "~$1~")
    
    // Lists: Slack doesn't have great list support, but we can use bullet points
    .replace(/^[\s]*[-*+]\s+/gm, "• ")
    .replace(/^[\s]*\d+\.\s+/gm, "1. ");
}

/**
 * Strip all markdown formatting for plain text fallback.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```/g, ""))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[\s]*[-*+]\s+/gm, "")
    .replace(/^[\s]*\d+\.\s+/gm, "");
}

/**
 * Split message if it's too long for Slack (4000 char limit).
 * Tries to split at natural boundaries like paragraphs or sentences.
 */
export function splitMessage(text: string, maxLength: number = 3900): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitPoint = maxLength;

    // Try to split at paragraph break
    const paragraphBreak = remaining.lastIndexOf("\n\n", maxLength);
    if (paragraphBreak > maxLength * 0.5) {
      splitPoint = paragraphBreak + 2;
    } else {
      // Try to split at sentence end
      const sentenceEnd = remaining.lastIndexOf(". ", maxLength);
      if (sentenceEnd > maxLength * 0.5) {
        splitPoint = sentenceEnd + 2;
      } else {
        // Try to split at line break
        const lineBreak = remaining.lastIndexOf("\n", maxLength);
        if (lineBreak > maxLength * 0.5) {
          splitPoint = lineBreak + 1;
        } else {
          // Split at word boundary
          const wordBoundary = remaining.lastIndexOf(" ", maxLength);
          if (wordBoundary > maxLength * 0.5) {
            splitPoint = wordBoundary + 1;
          }
        }
      }
    }

    chunks.push(remaining.slice(0, splitPoint).trim());
    remaining = remaining.slice(splitPoint).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}