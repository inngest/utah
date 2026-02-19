/**
 * Tools — capabilities the agent can use during the think/act/observe loop.
 *
 * Uses TypeBox schemas (via pi-ai) for type-safe tool definitions
 * that work across LLM providers.
 */

import { Type } from "@mariozechner/pi-ai";
import type { Tool } from "@mariozechner/pi-ai";
import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { exec } from "child_process";
import { config } from "../config.ts";

// --- Tool Definitions (TypeBox schemas) ---

export const TOOLS: Tool[] = [
  {
    name: "read_file",
    description: "Read the contents of a file",
    parameters: Type.Object({
      path: Type.String({ description: "File path (relative to workspace or absolute)" }),
    }),
  },
  {
    name: "write_file",
    description: "Write content to a file (creates directories if needed)",
    parameters: Type.Object({
      path: Type.String({ description: "File path" }),
      content: Type.String({ description: "Content to write" }),
    }),
  },
  {
    name: "list_directory",
    description: "List files in a directory",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Directory path (default: workspace root)" })),
    }),
  },
  {
    name: "run_command",
    description: "Run a shell command and return stdout/stderr",
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to execute" }),
      cwd: Type.Optional(Type.String({ description: "Working directory (default: workspace)" })),
    }),
  },
  {
    name: "web_fetch",
    description: "Fetch a URL and return the response body as text",
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch" }),
    }),
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
        return { result: content.slice(0, 50_000) };
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
