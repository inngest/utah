/**
 * Compaction — LLM-powered conversation summarization.
 *
 * When the conversation gets too long, older messages are summarized
 * into a structured checkpoint. Recent messages are kept verbatim.
 * Uses pi-ai's complete() for the summarization call — same provider
 * as the main agent loop.
 *
 * Inspired by OpenClaw/pi-agent-core's compaction system.
 */

import { callLLM } from "./llm.ts";
import { loadSession, writeSession, type SessionMessage } from "./session.ts";
import { config } from "../config.ts";

// --- Summarization Prompts ---

const SUMMARIZATION_SYSTEM_PROMPT =
  "You are a summarization assistant. Create concise, structured summaries that preserve all important context, decisions, and progress.";

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

// --- Token Estimation ---

// SessionMessage imported from ./session.ts

function estimateMessageTokens(msg: SessionMessage): number {
  // Session messages always have string content (serialized from JSONL)
  const chars = msg.content.length;
  return Math.ceil(chars / 4);
}

export function estimateTokens(messages: SessionMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

// --- Compaction Logic ---

/**
 * Check if compaction should run based on estimated token count.
 */
export function shouldCompact(messages: SessionMessage[]): boolean {
  const estimated = estimateTokens(messages);
  return estimated > config.compaction.maxTokens * config.compaction.threshold;
}

/**
 * Serialize messages to text for the summarization LLM.
 */
function serializeConversation(messages: SessionMessage[]): string {
  return messages
    .map((msg) => {
      const role = msg.role.toUpperCase();
      return `${role}: ${msg.content}`;
    })
    .join("\n\n");
}

/**
 * Run compaction: summarize old messages, keep recent ones.
 *
 * Uses pi-ai's complete() for the summarization call, so it works
 * with whatever provider is configured (Anthropic, OpenAI, Google).
 *
 * Returns the new message array (summary + recent).
 */
export async function runCompaction(
  messages: SessionMessage[],
  sessionKey: string,
): Promise<SessionMessage[]> {
  // Find cut point: keep approximately keepRecentTokens worth of recent messages
  let recentTokens = 0;
  let cutIndex = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    recentTokens += estimateMessageTokens(messages[i]);
    if (recentTokens >= config.compaction.keepRecentTokens) {
      cutIndex = i;
      break;
    }
  }

  // Don't compact if cut would leave nothing to summarize
  if (cutIndex <= 1) return messages;

  const toSummarize = messages.slice(0, cutIndex);
  const toKeep = messages.slice(cutIndex);

  // Generate summary using pi-ai
  const conversationText = serializeConversation(toSummarize);
  const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${SUMMARIZATION_PROMPT}`;

  const response = await callLLM(
    SUMMARIZATION_SYSTEM_PROMPT,
    [{ role: "user", content: promptText } as any],
    [], // no tools for summarization
  );

  const summaryText = response.text;

  // Build compacted message array
  const summaryMessage: SessionMessage = {
    role: "user",
    content: `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${summaryText}\n</summary>`,
    timestamp: new Date().toISOString(),
  };

  const compacted = [summaryMessage, ...toKeep];

  // Persist the compacted session
  await writeSession(sessionKey, compacted);

  console.log(
    `[compaction] ${messages.length} messages → ${compacted.length} (summarized ${toSummarize.length}, kept ${toKeep.length})`
  );

  return compacted;
}
