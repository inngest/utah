/**
 * Session — JSONL-based conversation history.
 *
 * Each message is appended as a JSON line. On load, the last N
 * messages are read for context. Simple, portable, inspectable.
 */

import { readFile, writeFile, appendFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { config } from "../config.ts";
import { logger } from "./logger.ts";

export interface SessionMessage {
  role: string;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

function sessionPath(sessionKey: string): string {
  return resolve(config.workspace.root, config.workspace.sessionDir, `${sessionKey}.jsonl`);
}

/**
 * Template files scaffolded on first run.
 * Only created if they don't already exist — never overwrites.
 */
const SCAFFOLD_FILES: Record<string, string> = {
  "SOUL.md": `# Soul
<!-- Who is this agent? Fill this in to define personality and behavior. -->

## Name
<!-- e.g. Utah -->

## Personality
<!-- e.g. Curious, helpful, slightly sarcastic -->

## Vibe
<!-- e.g. Chill but focused. Like a friendly coworker. -->

## Guidelines
<!-- Any rules or principles this agent should follow -->
`,

  "IDENTITY.md": `# Identity
<!-- Quick-reference identity card for this agent. -->

- **Name:**
- **Creature type:** <!-- e.g. AI assistant, desert spirit, robot -->
- **Emoji:** <!-- e.g. 🏜️ -->
`,

  "USER.md": `# User
<!-- Info about the human this agent works with. -->

- **Name:**
- **Timezone:**
- **Preferences:**
<!-- Add anything that helps the agent be more useful -->
`,

  "MEMORY.md": `# Long-Term Memory
<!-- This file is the agent's curated long-term memory.
     The agent reads it each session for continuity.
     It can be updated manually or by the agent itself.
     Keep it concise — distilled insights, not raw logs. -->
`,
};

export async function ensureWorkspace(root: string): Promise<void> {
  const dirs = [
    root,
    resolve(root, config.workspace.sessionDir),
    resolve(root, config.workspace.memoryDir),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
      logger.info(`Created directory: ${dir}`);
    }
  }

  // Scaffold template files (never overwrite existing)
  let created = 0;
  for (const [filename, content] of Object.entries(SCAFFOLD_FILES)) {
    const filePath = resolve(root, filename);
    if (!existsSync(filePath)) {
      await writeFile(filePath, content, "utf-8");
      logger.info(`Created ${filename}`);
      created++;
    }
  }

  if (created === 0) {
    logger.info("Workspace already initialized");
  } else {
    logger.info(`Scaffolded ${created} file(s) in workspace`);
  }
}

export async function loadSession(sessionKey: string, maxMessages = 20): Promise<SessionMessage[]> {
  const path = sessionPath(sessionKey);
  try {
    const content = await readFile(path, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    return lines.map((l) => JSON.parse(l) as SessionMessage).slice(-maxMessages);
  } catch {
    return [];
  }
}

export async function appendToSession(
  sessionKey: string,
  role: string,
  content: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const path = sessionPath(sessionKey);
  await mkdir(dirname(path), { recursive: true });
  const msg: SessionMessage = { role, content, timestamp: new Date().toISOString(), metadata };
  await appendFile(path, JSON.stringify(msg) + "\n", "utf-8");
}

/**
 * Rewrite the entire session file (used after compaction).
 */
export async function writeSession(sessionKey: string, messages: SessionMessage[]): Promise<void> {
  const path = sessionPath(sessionKey);
  await mkdir(dirname(path), { recursive: true });
  const content = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
  await writeFile(path, content, "utf-8");
}
