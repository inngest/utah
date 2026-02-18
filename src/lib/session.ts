/**
 * Session — JSONL-based conversation history.
 *
 * Each message is appended as a JSON line. On load, the last N
 * messages are read for context. Simple, portable, inspectable.
 */

import { readFile, appendFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { config } from "../config.ts";

interface SessionMessage {
  role: string;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

function sessionPath(sessionKey: string): string {
  return resolve(config.workspace.root, config.workspace.sessionDir, `${sessionKey}.jsonl`);
}

export async function ensureWorkspace(root: string): Promise<void> {
  const dirs = [root, resolve(root, config.workspace.sessionDir)];
  for (const dir of dirs) {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
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
