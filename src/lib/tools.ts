/**
 * Tools — pi-coding-agent's battle-tested coding tools, wrapped for Inngest steps.
 *
 * Uses pi-coding-agent's tool implementations directly:
 * - read: offset/limit, image support, binary detection, smart truncation
 * - edit: exact text match + replace (surgical edits, not full file rewrites)
 * - write: create/overwrite files with directory creation
 * - bash: shell execution with configurable timeout and output truncation
 * - grep: regex search respecting .gitignore
 * - find: glob-based file discovery respecting .gitignore
 * - ls: directory listing with tree display
 *
 * Plus custom tools specific to Utah (remember, web_fetch).
 */

import { Type } from "@mariozechner/pi-ai";
import type { Tool, TextContent } from "@mariozechner/pi-ai";
import {
  createReadTool,
  createEditTool,
  createWriteTool,
  createBashTool,
  createGrepTool,
  createFindTool,
  createLsTool,
} from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { config } from "../config.ts";
import { appendDailyLog } from "./memory.ts";

const TOOL_TIMEOUT_MS = 60_000;

// --- Pi-coding-agent tools (configured for workspace) ---

// Cast to AgentTool<any>[] — the specific TSchema generics cause contravariance issues
// but the tools are used dynamically (looked up by name) so this is safe.
const piTools: AgentTool<any>[] = [
  createReadTool(config.workspace.root),
  createEditTool(config.workspace.root),
  createWriteTool(config.workspace.root),
  createBashTool(config.workspace.root),
  createGrepTool(config.workspace.root),
  createFindTool(config.workspace.root),
  createLsTool(config.workspace.root),
];

// --- Custom Utah tools ---

const rememberTool: Tool = {
  name: "remember",
  description:
    "Save a note to today's daily log. Use for things you want to remember across conversations — decisions, facts, user preferences, task outcomes.",
  parameters: Type.Object({
    note: Type.String({ description: "The note to save" }),
  }),
};

const webFetchTool: Tool = {
  name: "web_fetch",
  description: "Fetch a URL and return the response body as text",
  parameters: Type.Object({
    url: Type.String({ description: "URL to fetch" }),
  }),
};

const delegateTaskTool: Tool = {
  name: "delegate_task",
  description:
    "Delegate a self-contained task to a sub-agent in an isolated context. The sub-agent has the same workspace and tools. You receive a summary of what it accomplished. Blocks until done.",
  parameters: Type.Object({
    task: Type.String({
      description:
        "Clear, detailed description of what the sub-agent should do. Include file paths, goals, and constraints.",
    }),
  }),
};

const delegateAsyncTaskTool: Tool = {
  name: "delegate_async_task",
  description:
    "Delegate a task to an async sub-agent that runs independently and replies directly to the user when done. You do NOT receive the result.",
  parameters: Type.Object({
    task: Type.String({
      description:
        "Clear, detailed description of what the sub-agent should do. Include file paths, goals, and constraints.",
    }),
  }),
};

const delegateScheduledTaskTool: Tool = {
  name: "delegate_scheduled_task",
  description:
    "Schedule a task for a sub-agent to run at a specific future time. The sub-agent runs at the scheduled time and replies directly to the user.",
  parameters: Type.Object({
    task: Type.String({
      description:
        "Clear, detailed description of what the sub-agent should do. Include file paths, goals, and constraints.",
    }),
    scheduledFor: Type.String({
      description:
        "ISO 8601 timestamp for when the task should run (e.g. '2026-03-10T09:00:00-05:00'). Use the current time from the system prompt and the user's timezone to calculate this.",
    }),
  }),
};

// --- Exports ---

/**
 * All tools available to the main agent (includes delegate_task).
 */
export const TOOLS: Tool[] = [
  ...piTools,
  rememberTool,
  webFetchTool,
  delegateTaskTool,
  delegateAsyncTaskTool,
  delegateScheduledTaskTool,
];

/**
 * Tools available to sub-agents (no delegate_task to prevent recursive spawning).
 */
export const SUB_AGENT_TOOLS: Tool[] = [...piTools, rememberTool, webFetchTool];

/**
 * Map of pi-coding-agent tools by name for direct execution.
 */
const piToolMap = new Map<string, AgentTool>(piTools.map((t) => [t.name, t]));

// --- Tool Execution ---

export interface ToolResult {
  /** Text content returned to the LLM */
  result: string;
  /** Whether this result represents an error */
  error?: boolean;
}

/**
 * Execute a tool by name.
 *
 * Pi-coding-agent tools are called via their execute() method.
 * Custom tools (remember, web_fetch) are handled inline.
 */
export async function executeTool(
  toolCallId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    // Check if it's a pi-coding-agent tool
    const piTool = piToolMap.get(name);
    if (piTool) {
      const result = await Promise.race([
        piTool.execute(toolCallId, args),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Tool "${name}" timed out after ${TOOL_TIMEOUT_MS / 1000}s`)),
            TOOL_TIMEOUT_MS,
          ),
        ),
      ]);

      // Convert AgentToolResult to our ToolResult format
      const text = result.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      return { result: text || "(no output)" };
    }

    // Custom tools
    switch (name) {
      case "remember": {
        await appendDailyLog(args.note as string);
        return { result: "Saved to today's log." };
      }
      case "web_fetch": {
        const res = await fetch(args.url as string, {
          signal: AbortSignal.timeout(30_000),
          headers: { "User-Agent": "Utah-Agent/1.0" },
        });
        const text = await res.text();
        return { result: text.slice(0, 50_000) };
      }
      default:
        return { result: `Unknown tool: ${name}`, error: true };
    }
  } catch (err) {
    return {
      result: `Error: ${err instanceof Error ? err.message : String(err)}`,
      error: true,
    };
  }
}
