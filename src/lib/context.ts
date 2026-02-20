/**
 * Context — builds the system prompt and conversation history for the agent.
 *
 * Loads identity files (SOUL.md, USER.md), memory, and session history
 * to give the agent full awareness of who it is and what's happened.
 */

import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { config } from "../config.ts";
import { buildMemoryContext } from "./memory.ts";
import { loadSession } from "./session.ts";

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
 * 1. Identity (SOUL.md or default)
 * 2. User info (USER.md)
 * 3. Memory (MEMORY.md + daily logs)
 * 4. Tool usage guidelines
 */
export async function buildSystemPrompt(): Promise<string> {
  const soul = await loadOptionalFile("SOUL.md");
  const user = await loadOptionalFile("USER.md");
  const memory = await buildMemoryContext();

  const parts: string[] = [];

  // Identity
  if (soul) {
    parts.push(soul);
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
  parts.push(`## Tools & Behavior
- You have tools for reading/writing files, running commands, fetching URLs, and saving memories.
- Use tools to gather information before answering when needed.
- Save important things to memory using the "remember" tool.
- Be concise and direct.
- Current time: ${new Date().toISOString()}

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
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const history = await loadSession(sessionKey, maxMessages);
  return history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
}
