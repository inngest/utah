/**
 * Heartbeat — periodic memory maintenance.
 *
 * Runs on a cron schedule to keep the agent's memory healthy:
 * 1. Reads recent daily logs (last 7 days)
 * 2. Reads current MEMORY.md
 * 3. Asks the LLM to distill daily logs into long-term memory
 * 4. Writes updated MEMORY.md
 * 5. Optionally prunes old daily logs
 *
 * This is how the agent builds curated, long-term memory from
 * raw daily notes — like a human reviewing their journal and
 * updating their mental model.
 *
 * The heartbeat is an Inngest cron function — it runs on a schedule,
 * completely independent of user messages. Each step is durable.
 */

import { inngest } from "../client.ts";
import { config } from "../config.ts";
import { readMemory, writeMemory, readDailyLog } from "../lib/memory.ts";
import { callLLM } from "../lib/llm.ts";
import { readdir, unlink } from "fs/promises";
import { resolve } from "path";

// --- Config ---

const HEARTBEAT_CRON = process.env.HEARTBEAT_CRON || "0 4 * * *"; // Default: 4am daily
const DAYS_TO_REVIEW = 7;    // Review last 7 days of logs
const DAYS_TO_KEEP = 14;     // Keep daily logs for 14 days, prune older

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

// --- The Function ---

export const heartbeat = inngest.createFunction(
  {
    id: "agent-heartbeat",
    name: "Memory Maintenance Heartbeat",
  },
  { cron: HEARTBEAT_CRON },
  async ({ step }) => {
    // Step 1: Load current memory + recent daily logs
    const context = await step.run("load-memory-context", async () => {
      const currentMemory = await readMemory();
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

    // Skip if no daily logs to process
    if (context.dailyLogs.length === 0) {
      return { status: "skipped", reason: "no recent daily logs" };
    }

    // Step 2: Ask LLM to distill daily logs into updated memory
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

Output ONLY the updated MEMORY.md content. No explanations or commentary.`;

      const response = await callLLM(
        "You are a memory maintenance assistant. Output only the updated MEMORY.md content.",
        [{ role: "user", content: prompt }],
        [], // No tools needed for summarization
      );

      return response.text;
    });

    // Step 3: Write updated MEMORY.md
    await step.run("write-memory", async () => {
      await writeMemory(updatedMemory);
    });

    // Step 4: Prune old daily logs
    const pruned = await step.run("prune-old-logs", async () => {
      const memoryDir = getMemoryDir();
      const cutoff = new Date(Date.now() - DAYS_TO_KEEP * 86400000);
      const cutoffStr = cutoff.toISOString().split("T")[0];

      let deleted = 0;
      try {
        const files = await readdir(memoryDir);
        for (const file of files) {
          // Match YYYY-MM-DD.md pattern
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
      status: "completed",
      dailyLogsReviewed: context.dailyLogs.length,
      oldLogsPruned: pruned.deleted,
    };
  },
);
