/**
 * File logger for the TUI.
 *
 * The TUI owns the terminal (alternate screen, raw mode), so anything written
 * to stdout/stderr corrupts the display. Instead we append structured lines to
 * ~/.inngest-agent/tui.log, which you can watch with:
 *
 *   tail -f ~/.inngest-agent/tui.log
 *
 * We also capture console.* (incl. the Inngest realtime SDK's own
 * `console.error` on WebSocket errors) into this file so SDK noise is recorded
 * rather than splattered over the UI.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR } from "./state.ts";

export const LOG_PATH = join(STATE_DIR, "tui.log");

export function log(msg: string, data?: Record<string, unknown>): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const line = JSON.stringify({ t: new Date().toISOString(), msg, ...data }) + "\n";
    appendFileSync(LOG_PATH, line);
  } catch {
    /* logging must never throw */
  }
}

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";
const METHODS: ConsoleMethod[] = ["log", "info", "warn", "error", "debug"];

/**
 * Redirect console.* to the log file for the lifetime of the TUI.
 * Returns a function that restores the originals.
 */
export function installConsoleCapture(): () => void {
  const original = {} as Record<ConsoleMethod, (...args: unknown[]) => void>;
  for (const method of METHODS) {
    original[method] = console[method] as (...args: unknown[]) => void;
    console[method] = (...args: unknown[]) => {
      log(`console.${method}`, {
        args: args.map((a) => (a instanceof Error ? a.stack || a.message : a)),
      });
    };
  }
  return () => {
    for (const method of METHODS) console[method] = original[method];
  };
}
