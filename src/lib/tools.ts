/**
 * Tools — capabilities the agent can use during the think/act/observe loop.
 */

import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { exec } from "child_process";
import { config } from "../config.ts";
import { appendDailyLog } from "./memory.ts";

// --- Tool Definitions (Anthropic format) ---

export const TOOLS = [
  {
    name: "read_file",
    description: "Read the contents of a file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path (relative to workspace or absolute)" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file (creates directories if needed)",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_directory",
    description: "List files in a directory",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path (default: workspace root)" },
      },
    },
  },
  {
    name: "run_command",
    description: "Run a shell command and return stdout/stderr",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        cwd: { type: "string", description: "Working directory (default: workspace)" },
      },
      required: ["command"],
    },
  },
  {
    name: "remember",
    description:
      "Save a note to today's daily log. Use for things you want to remember across conversations — decisions, facts, user preferences, task outcomes.",
    parameters: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description: "The note to save",
        },
      },
      required: ["note"],
    },
  },
  {
    name: "web_fetch",
    description: "Fetch a URL and return the response body as text",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
      },
      required: ["url"],
    },
  },
];

// --- Tool Execution ---

interface ToolResult {
  result: string;
  error?: boolean;
}

function resolvePath(filePath: string): string {
  return filePath.startsWith("/") ? filePath : resolve(config.workspace.root, filePath);
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "read_file": {
        const fullPath = resolvePath(args.path as string);
        const content = await readFile(fullPath, "utf-8");
        return { result: content.slice(0, 50_000) }; // Cap large files
      }
      case "write_file": {
        const fullPath = resolvePath(args.path as string);
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, args.content as string, "utf-8");
        return { result: `Written to ${args.path}` };
      }
      case "list_directory": {
        const dirPath = resolvePath((args.path as string) || ".");
        if (!existsSync(dirPath)) return { result: "Directory not found", error: true };
        const entries = await readdir(dirPath, { withFileTypes: true });
        const list = entries.map((e) => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`);
        return { result: list.join("\n") || "(empty directory)" };
      }
      case "run_command": {
        const cwd = resolvePath((args.cwd as string) || ".");
        const output = await runShellCommand(args.command as string, cwd);
        return { result: output.slice(0, 50_000) };
      }
      case "remember": {
        await appendDailyLog(args.note as string);
        return { result: "Saved to today's log." };
      }
      case "web_fetch": {
        const res = await fetch(args.url as string, {
          signal: AbortSignal.timeout(30_000),
          headers: { "User-Agent": "InngstAgent/1.0" },
        });
        const text = await res.text();
        return { result: text.slice(0, 50_000) };
      }
      default:
        return { result: `Unknown tool: ${name}`, error: true };
    }
  } catch (err) {
    return { result: `Error: ${err instanceof Error ? err.message : String(err)}`, error: true };
  }
}

function runShellCommand(command: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: 30_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        resolve(`Exit code: ${err.code}\nstdout: ${stdout}\nstderr: ${stderr}`);
      } else {
        resolve(stdout + (stderr ? `\nstderr: ${stderr}` : ""));
      }
    });
  });
}
