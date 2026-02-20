/**
 * Memory — file-based memory system
 *
 * Gives the agent persistent memory across sessions:
 * - MEMORY.md: curated long-term memory (agent maintains this)
 * - memory/YYYY-MM-DD.md: daily logs (append-only via "remember" tool)
 *
 * Memory is loaded into the system prompt at the start of each run,
 * giving the agent awareness of past conversations and decisions.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { config } from "../config.ts";

function getWorkspacePath(...parts: string[]): string {
  return resolve(config.workspace.root, ...parts);
}

function todayString(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Ensure workspace directories exist (sessions, memory).
 * Call once at the start of each agent run.
 */
export async function ensureWorkspace(): Promise<void> {
  const dirs = [
    config.workspace.root,
    getWorkspacePath(config.workspace.memoryDir),
    getWorkspacePath(config.workspace.sessionDir),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }
}

/**
 * Read MEMORY.md — the agent's curated long-term memory.
 */
export async function readMemory(): Promise<string> {
  const path = getWorkspacePath(config.workspace.memoryFile);
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Write/replace MEMORY.md contents.
 */
export async function writeMemory(content: string): Promise<void> {
  const path = getWorkspacePath(config.workspace.memoryFile);
  await writeFile(path, content, "utf-8");
}

/**
 * Read a daily log file (defaults to today).
 */
export async function readDailyLog(date?: string): Promise<string> {
  const d = date || todayString();
  const path = getWorkspacePath(config.workspace.memoryDir, `${d}.md`);
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Append an entry to today's daily log.
 * Used by the "remember" tool — the agent calls this to persist notes.
 */
export async function appendDailyLog(entry: string): Promise<void> {
  const d = todayString();
  const path = getWorkspacePath(config.workspace.memoryDir, `${d}.md`);
  const existing = await readDailyLog(d);
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  const content = existing
    ? `${existing}\n\n### ${timestamp}\n${entry}`
    : `# ${d}\n\n### ${timestamp}\n${entry}`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf-8");
}

/**
 * Build the memory context block injected into the system prompt.
 * Loads long-term memory + yesterday's log + today's log.
 */
export async function buildMemoryContext(): Promise<string> {
  const memory = await readMemory();
  const today = await readDailyLog();
  const yesterday = await readDailyLog(
    new Date(Date.now() - 86400000).toISOString().split("T")[0],
  );

  const parts: string[] = [];

  if (memory) {
    parts.push(`### Long-Term Memory (MEMORY.md)\n${memory}`);
  }
  if (yesterday) {
    parts.push(`### Yesterday's Log\n${yesterday}`);
  }
  if (today) {
    parts.push(`### Today's Log\n${today}`);
  }

  return parts.join("\n\n---\n\n") || "(No memory files found yet. Use the 'remember' tool to start building memory.)";
}
