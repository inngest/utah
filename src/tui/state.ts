/**
 * Local TUI state — persisted to ~/.inngest-agent/.
 *
 * There can be many active sessions across different terminal windows, so we
 * keep a small index of all known sessions plus a per-session transcript so a
 * window can reload its history after a restart.
 *
 * Layout:
 *   ~/.inngest-agent/
 *     index.json              — { sessions: SessionMeta[] }
 *     sessions/<id>.jsonl      — one TranscriptLine per line
 *
 * The authoritative conversation history lives server-side (the agent's
 * workspace/sessions). This local copy is purely for the TUI's own display.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";

export const STATE_DIR = join(homedir(), ".inngest-agent");
const SESSIONS_DIR = join(STATE_DIR, "sessions");
const INDEX_PATH = join(STATE_DIR, "index.json");

export interface SessionMeta {
  /** Session id — also the realtime channel suffix and the agent's sessionKey. */
  id: string;
  createdAt: string;
  lastActiveAt: string;
  /** First user message, truncated — used as a label in /sessions. */
  title?: string;
}

export interface TranscriptLine {
  role: "user" | "assistant" | "system";
  content: string;
  ts: string;
}

interface Index {
  sessions: SessionMeta[];
}

function sessionFile(id: string): string {
  return join(SESSIONS_DIR, `${id}.jsonl`);
}

async function ensureDirs(): Promise<void> {
  await mkdir(SESSIONS_DIR, { recursive: true });
}

async function readIndex(): Promise<Index> {
  try {
    return JSON.parse(await readFile(INDEX_PATH, "utf-8")) as Index;
  } catch {
    return { sessions: [] };
  }
}

async function writeIndex(index: Index): Promise<void> {
  await ensureDirs();
  await writeFile(INDEX_PATH, JSON.stringify(index, null, 2), "utf-8");
}

/** Short, human-friendly id (collision-safe enough for local sessions). */
function newId(): string {
  return `s_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/** Create and persist a brand-new session. */
export async function createSession(): Promise<SessionMeta> {
  await ensureDirs();
  const now = new Date().toISOString();
  const meta: SessionMeta = { id: newId(), createdAt: now, lastActiveAt: now };
  const index = await readIndex();
  index.sessions.push(meta);
  await writeIndex(index);
  return meta;
}

/** All known sessions, most-recently-active first. */
export async function listSessions(): Promise<SessionMeta[]> {
  const { sessions } = await readIndex();
  return [...sessions].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
}

export async function getSession(id: string): Promise<SessionMeta | undefined> {
  const { sessions } = await readIndex();
  return sessions.find((s) => s.id === id);
}

/** Update lastActiveAt (and title, if not yet set) for a session. */
export async function touchSession(id: string, title?: string): Promise<void> {
  const index = await readIndex();
  const meta = index.sessions.find((s) => s.id === id);
  if (!meta) return;
  meta.lastActiveAt = new Date().toISOString();
  if (title && !meta.title) meta.title = title.slice(0, 60);
  await writeIndex(index);
}

/** Append a line to a session's local transcript. */
export async function appendTranscript(
  id: string,
  role: TranscriptLine["role"],
  content: string,
): Promise<void> {
  await ensureDirs();
  const line: TranscriptLine = { role, content, ts: new Date().toISOString() };
  await appendFile(sessionFile(id), JSON.stringify(line) + "\n", "utf-8");
}

/** Load a session's local transcript (empty if none yet). */
export async function loadTranscript(id: string): Promise<TranscriptLine[]> {
  try {
    const raw = await readFile(sessionFile(id), "utf-8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as TranscriptLine);
  } catch {
    return [];
  }
}
