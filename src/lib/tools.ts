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
import type { Tool } from "@mariozechner/pi-ai";
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

// --- Pi-coding-agent tools (configured for workspace) ---

// Cast to AgentTool<any>[] — the specific TSchema generics cause contravariance issues
// but the tools are used dynamically (looked up by name) so this is safe.
const piTools: AgentTool<any>[] = [
  createReadTool(config.workspace.root) as AgentTool<any>,
  createEditTool(config.workspace.root) as AgentTool<any>,
  createWriteTool(config.workspace.root) as AgentTool<any>,
  createBashTool(config.workspace.root) as AgentTool<any>,
  createGrepTool(config.workspace.root) as AgentTool<any>,
  createFindTool(config.workspace.root) as AgentTool<any>,
  createLsTool(config.workspace.root) as AgentTool<any>,
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
  description: `Delegate a self-contained task to a sub-agent that runs in an isolated context window.
Use this when:
- The task requires many file reads/edits (4+ tool calls expected)
- The task is independent and can be described as a clear goal
- You want to keep your own context lean
The sub-agent has access to the same workspace and tools but its own conversation.
You'll receive a summary of what it accomplished.`,
  parameters: Type.Object({
    task: Type.String({
      description:
        "Clear, detailed description of what the sub-agent should do. Include file paths, goals, and constraints.",
    }),
  }),
};

// --- Exports ---

/**
 * All tools available to the main agent (includes delegate_task).
 */
export const TOOLS: Tool[] = [...piTools, rememberTool, webFetchTool, delegateTaskTool];

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
      const result = await piTool.execute(toolCallId, args);

      // Convert AgentToolResult to our ToolResult format
      const text = result.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { type: "text"; text: string }).text)
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
