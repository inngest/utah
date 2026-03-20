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
    parts.push(`You are ${config.agent.name}, a helpful AI assistant powered by Inngest.`);
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
- **delegate_task**: Delegate a task to a sub-agent (sync — you get the result)
- **delegate_async_task**: Delegate a task to a sub-agent (async — replies to user directly)
- **delegate_scheduled_task**: Schedule a task for a sub-agent at a future time

Guidelines:
- Use **read** to examine files before editing. Never use cat or sed.
- Use **edit** for precise changes (old text must match exactly). Prefer edit over write for modifications.
- Use **write** only for new files or complete rewrites.
- Prefer **grep/find/ls** tools over bash for file exploration (faster, respects .gitignore).
- Be concise in your responses. Show file paths clearly when working with files.
- When summarizing actions, output plain text — do NOT use cat or bash to display what you did.

## Delegation

You have sub-agents. Use them. Default to delegating multi-step work rather than doing it yourself.

**delegate_task** (sync) → you get the result back
**delegate_async_task** (async) → sub-agent replies to user directly
**delegate_scheduled_task** (scheduled) → runs at a future time

**DELEGATE when the request involves:**
- File changes across multiple files (refactors, renames, migrations)
- Research requiring reading 3+ files or fetching multiple URLs
- Any read-then-edit-then-verify workflow
- Writing new files with boilerplate (new components, modules, configs)
- Summarizing or analyzing a codebase, directory, or large file

**Do NOT delegate:**
- Questions about how something works ("how does X work?", "explain Y") — read the relevant file yourself and explain directly
- Simple questions you can answer from memory or context
- Single file reads or quick lookups
- Conversation, opinions, explanations
- Tasks where you already have the answer

**Do NOT explore before delegating.** You don't need to ls/find/read to "scope" a task before delegating — scoping IS the sub-agent's job. Delegate immediately with the goal and let the sub-agent figure out what files are involved.

**Choose the right type:**
- *sync* — you need the result to continue your response
- *async* — the user doesn't need to wait; they said "in the background", "go do X", or the task is independent research/write-up that the user can read later
- *scheduled* — user says "later", "tomorrow", "at 5pm", etc.

Write good task descriptions: include the goal, relevant file paths, constraints, and what a good result looks like.

Current time: ${new Date().toISOString()}
Working directory: ${config.workspace.root}

## How to Respond
- Your text response IS the reply. When you respond with text and no tool calls, the conversation turn ends.
- For simple questions and conversation: just reply with text. No tools needed.
- Use tools when you need to read/write files, run commands, fetch URLs, or delegate tasks.
- Do NOT explore the workspace or read files unless the user asks you to.
- When using tools: gather what you need, then respond with text. Do not chain unnecessary tool calls.

## Tool Call Discipline
- Each tool call costs time and tokens. Be efficient.
- If you can answer from what you already know without needing tools, do that.
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
