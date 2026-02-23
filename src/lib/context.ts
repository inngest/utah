/**
 * Context — builds the system prompt and conversation history for the agent.
 *
 * Injects workspace context files (IDENTITY.md, SOUL.md, USER.md) and
 * memory (MEMORY.md + daily logs) into the system prompt.
 */

import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { config } from "../config.ts";
import { buildMemoryContext } from "./memory.ts";
import { loadSession, type SessionMessage } from "./session.ts";

/**
 * Load an optional markdown file from the workspace root.
 * Returns null if the file doesn't exist.
 */
async function loadOptionalFile(filename: string): Promise<string | null> {
  const path = resolve(config.workspace.root, filename);
  if (!existsSync(path)) return null;
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Build the full system prompt.
 *
 * Structure:
 * 1. Identity (IDENTITY.md, SOUL.md, or default)
 * 2. User info (USER.md)
 * 3. Memory (MEMORY.md + daily logs)
 * 4. Tool usage guidelines
 */
export async function buildSystemPrompt(): Promise<string> {
  const identity = await loadOptionalFile("IDENTITY.md");
  const soul = await loadOptionalFile("SOUL.md");
  const user = await loadOptionalFile("USER.md");
  const memory = await buildMemoryContext();

  const parts: string[] = [];

  // Identity
  if (soul) {
    parts.push(soul);
  } else if (identity) {
    parts.push(identity);
  } else {
    parts.push(
      `You are ${config.agent.name}, a helpful AI assistant powered by Inngest.`,
    );
  }

  // User info
  if (user) {
    parts.push(`## About the User\n${user}`);
  }

  // Memory
  parts.push(`## Memory\n${memory}`);

  // Guidelines
  parts.push(`## Tools & Guidelines

Available tools:
- **read**: Read file contents (supports offset/limit for large files)
- **edit**: Make precise edits to files (find exact text and replace — use this for surgical changes)
- **write**: Create new files or completely overwrite existing ones
- **bash**: Execute shell commands (ls, grep, find, curl, etc.)
- **grep**: Search file contents for patterns (respects .gitignore)
- **find**: Find files by glob pattern (respects .gitignore)
- **ls**: List directory contents
- **remember**: Save a note to today's daily log
- **web_fetch**: Fetch a URL and return the body as text

Guidelines:
- Use **read** to examine files before editing. Never use cat or sed.
- Use **edit** for precise changes (old text must match exactly). Prefer edit over write for modifications.
- Use **write** only for new files or complete rewrites.
- Prefer **grep/find/ls** tools over bash for file exploration (faster, respects .gitignore).
- Be concise in your responses. Show file paths clearly when working with files.
- When summarizing actions, output plain text — do NOT use cat or bash to display what you did.

Current time: ${new Date().toISOString()}
Working directory: ${config.workspace.root}

## How to Respond
- Your text response IS the reply. When you respond with text and no tool calls, the conversation turn ends.
- For most messages: just reply with text. No tools needed.
- Only use tools when you actually need to read/write files, run commands, or fetch URLs.
- Do NOT explore the workspace or read files unless the user asks you to.
- When using tools: gather what you need, then respond with text. Do not chain unnecessary tool calls.

## Tool Call Discipline
- Each tool call costs time and tokens. Be efficient.
- If you can answer from what you already know, do that.
- If one tool call gives you the answer, respond immediately.
- Never loop on the same tool with slightly different inputs hoping for a better result.`);

  return parts.join("\n\n---\n\n");
}

/**
 * Build conversation messages from session history.
 */
export async function buildConversationHistory(
  sessionKey: string,
  maxMessages = 10,
): Promise<SessionMessage[]> {
  const history = await loadSession(sessionKey, maxMessages);
  return history.filter((m) => m.role === "user" || m.role === "assistant");
}
