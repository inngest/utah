/**
 * Heartbeat — adaptive memory maintenance.
 *
 * Runs on a frequent cron (default: every 30min) but only triggers
 * LLM distillation when actually needed:
 *
 * 1. Parse last_heartbeat timestamp from MEMORY.md (no LLM, just string parse)
 * 2. Check today's daily log size
 * 3. IF log > threshold OR hours since last distill > max → run distillation
 * 4. ELSE → skip (costs nothing)
 *
 * This means:
 * - Light days: distills once or twice
 * - Heavy days (lots of "remember" calls): distills as soon as logs get chunky
 * - Most runs are just a file stat + string parse — no LLM cost
 *
 * Each step is durable — retries on failure, observable in Inngest dashboard.
 */

import { inngest } from "../client.ts";
import { config } from "../config.ts";
import {
  readMemory, writeMemory, readDailyLog,
  parseLastHeartbeat, stripTimestamp, appendTimestamp,
} from "../lib/memory.ts";
import { callLLM } from "../lib/llm.ts";
import { readdir, unlink } from "fs/promises";
import { resolve } from "path";

// --- Config ---

const HEARTBEAT_CRON = process.env.HEARTBEAT_CRON || "*/30 * * * *"; // Every 30 minutes
const LOG_SIZE_THRESHOLD = 4096;  // Bytes — distill when daily log exceeds this
const MAX_HOURS_BETWEEN = 8;      // Force distill after this many hours
const DAYS_TO_REVIEW = 7;        // Review last 7 days of logs
const DAYS_TO_KEEP = parseInt(process.env.MEMORY_RETENTION_DAYS || "30"); // Prune daily logs older than this

// --- Helpers ---

function getRecentDates(days: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86400000);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

function getMemoryDir(): string {
  return resolve(config.workspace.root, config.workspace.memoryDir);
}

function todayString(): string {
  return new Date().toISOString().split("T")[0];
}

// --- The Function ---

export const heartbeat = inngest.createFunction(
  {
    id: "agent-heartbeat",
    name: "Memory Maintenance Heartbeat",
  },
  { cron: HEARTBEAT_CRON },
  async ({ step }) => {
    // Step 1: Check if distillation is needed (no LLM — just file reads)
    const check = await step.run("check-if-needed", async () => {
      const currentMemory = await readMemory();
      const lastHeartbeat = parseLastHeartbeat(currentMemory);

      // Check daily log size
      const todayLog = await readDailyLog(todayString());
      const logSize = Buffer.byteLength(todayLog, "utf-8");

      // Check hours since last heartbeat
      const hoursSinceLast = lastHeartbeat
        ? (Date.now() - lastHeartbeat.getTime()) / (1000 * 60 * 60)
        : Infinity; // Never run before — always distill

      const shouldDistill =
        logSize > LOG_SIZE_THRESHOLD || hoursSinceLast > MAX_HOURS_BETWEEN;

      return {
        shouldDistill,
        logSize,
        hoursSinceLast: Math.round(hoursSinceLast * 10) / 10,
        reason: !shouldDistill
          ? "below thresholds"
          : logSize > LOG_SIZE_THRESHOLD
            ? `daily log size (${logSize} bytes > ${LOG_SIZE_THRESHOLD})`
            : `time since last (${Math.round(hoursSinceLast)}h > ${MAX_HOURS_BETWEEN}h)`,
      };
    });

    // Early exit — most runs will hit this
    if (!check.shouldDistill) {
      return {
        status: "skipped",
        reason: check.reason,
        logSize: check.logSize,
        hoursSinceLast: check.hoursSinceLast,
      };
    }

    // Step 2: Load full context for distillation
    const context = await step.run("load-memory-context", async () => {
      const currentMemory = stripTimestamp(await readMemory());
      const dates = getRecentDates(DAYS_TO_REVIEW);

      const dailyLogs: { date: string; content: string }[] = [];
      for (const date of dates) {
        const log = await readDailyLog(date);
        if (log.trim()) {
          dailyLogs.push({ date, content: log });
        }
      }

      return { currentMemory, dailyLogs };
    });

    // Skip if somehow no logs (shouldn't happen given check above)
    if (context.dailyLogs.length === 0) {
      return { status: "skipped", reason: "no daily logs found" };
    }

    // Step 3: LLM distillation
    const updatedMemory = await step.run("distill-memory", async () => {
      const dailyLogText = context.dailyLogs
        .map((l) => `## ${l.date}\n${l.content}`)
        .join("\n\n---\n\n");

      const prompt = `You are maintaining an AI agent's long-term memory file (MEMORY.md).

## Current MEMORY.md
${context.currentMemory || "(empty — this is a fresh start)"}

## Recent Daily Logs
${dailyLogText}

## Your Task
Update MEMORY.md by incorporating important information from the daily logs:

1. **Add** new facts, decisions, preferences, and lessons learned
2. **Update** existing entries if new information supersedes them
3. **Remove** anything that's clearly outdated or no longer relevant
4. **Keep it concise** — this is curated memory, not a raw log
5. **Preserve structure** — use markdown headers and bullets for organization
6. **Don't include timestamps or log formatting** — distill into clean notes

Output ONLY the updated MEMORY.md content. No explanations or commentary.`;

      const response = await callLLM(
        "You are a memory maintenance assistant. Output only the updated MEMORY.md content.",
        [{ role: "user", content: prompt }],
        [], // No tools needed
      );

      return response.text;
    });

    // Step 4: Write updated MEMORY.md with timestamp
    await step.run("write-memory", async () => {
      const withTimestamp = appendTimestamp(updatedMemory);
      await writeMemory(withTimestamp);
    });

    // Step 5: Prune old daily logs
    const pruned = await step.run("prune-old-logs", async () => {
      const memoryDir = getMemoryDir();
      const cutoff = new Date(Date.now() - DAYS_TO_KEEP * 86400000);
      const cutoffStr = cutoff.toISOString().split("T")[0];

      let deleted = 0;
      try {
        const files = await readdir(memoryDir);
        for (const file of files) {
          const match = file.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
          if (match && match[1] < cutoffStr) {
            await unlink(resolve(memoryDir, file));
            deleted++;
          }
        }
      } catch {
        // Memory dir might not exist yet
      }

      return { deleted };
    });

    return {
      status: "distilled",
      trigger: check.reason,
      dailyLogsReviewed: context.dailyLogs.length,
      oldLogsPruned: pruned.deleted,
    };
  },
);
