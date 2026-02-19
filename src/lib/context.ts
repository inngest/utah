/**
 * Context — builds the system prompt for the agent.
 *
 * Injects workspace context files (IDENTITY.md, SOUL.md, USER.md, MEMORY.md)
 * into the system prompt, similar to how OpenClaw/pi-agent-core bootstraps
 * agent identity. If files don't exist, they're simply skipped.
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { config } from "../config.ts";

// Files to inject into the system prompt (order matters)
const CONTEXT_FILES = ["IDENTITY.md", "SOUL.md", "USER.md", "MEMORY.md"];

export function buildSystemPrompt(): string {
  const base = `You are ${config.agent.name}, a helpful AI assistant.

## Tools & Behavior
- You have tools for reading/writing files, running commands, and fetching URLs.
- Use tools to gather information before answering when needed.
- Be concise and direct.
- Current time: ${new Date().toISOString()}

## How to Respond
- Your text response IS the reply. When you respond with text and no tool calls, the conversation turn ends.
- For most messages: just reply with text. No tools needed.
- Only use tools when you actually need to read/write files, run commands, or fetch URLs.
- When using tools: gather what you need, then respond with text. Do not chain unnecessary tool calls.

## Tool Call Discipline
- Each tool call costs time and tokens. Be efficient.
- If you can answer from what you already know, do that.
- If one tool call gives you the answer, respond immediately.
- Never loop on the same tool with slightly different inputs hoping for a better result.`;

  // Inject workspace context files
  const contextParts: string[] = [];

  for (const file of CONTEXT_FILES) {
    const filePath = resolve(config.workspace.root, file);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8").trim();
      if (content) {
        contextParts.push(`## ${file}\n${content}`);
      }
    }
  }

  // Also check for a memory.md file (append-only memory log)
  const memoryPath = resolve(config.workspace.root, "memory.md");
  if (memoryPath !== resolve(config.workspace.root, "MEMORY.md") && existsSync(memoryPath)) {
    const memory = readFileSync(memoryPath, "utf-8").trim();
    if (memory) {
      contextParts.push(`## Memory Log\n${memory}`);
    }
  }

  if (contextParts.length > 0) {
    return base + "\n\n# Workspace Context\n\n" + contextParts.join("\n\n");
  }

  return base;
}
