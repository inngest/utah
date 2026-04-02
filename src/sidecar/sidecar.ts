/**
 * Sidecar — dynamically loads Inngest functions from the workspace/functions/ directory
 * and connects them to Inngest Cloud via WebSocket.
 *
 * Watches for file changes and reconnects with updated function list.
 */

import { connect, type WorkerConnection } from "inngest/connect";
import { watch, type FSWatcher } from "node:fs";
import { readdir, access, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { inngest as sidecarClient } from "./client";

// --- Config ---
// Mirror workspace root logic from src/config.ts — we can't import config directly
// because the sidecar runs with --experimental-strip-types (no .js build output).
const WORKSPACE_ROOT = resolve(process.env.AGENT_WORKSPACE || "./workspace");
const FUNCTIONS_DIR = join(WORKSPACE_ROOT, "functions");
const DEBOUNCE_MS = 2000;
const HEARTBEAT_CRON = "*/30 * * * *";

// --- Logging ---

function log(level: string, msg: string, data?: Record<string, unknown>) {
  const entry = {
    time: new Date().toISOString(),
    level,
    msg,
    ...data,
  };
  console.log(JSON.stringify(entry));
}

// --- Function loading ---

async function ensureDir(dir: string) {
  try {
    await access(dir);
  } catch {
    await mkdir(dir, { recursive: true });
    log("info", `Created directory: ${dir}`);
  }
}

function shouldLoadFile(filename: string): boolean {
  return filename.endsWith(".ts") && !filename.startsWith("_") && filename !== "client.ts";
}

async function loadFunctions(): Promise<Array<{ id: string; fn: unknown }>> {
  const loaded: Array<{ id: string; fn: unknown }> = [];

  let files: string[];
  try {
    files = await readdir(FUNCTIONS_DIR);
  } catch (err) {
    log("error", "Failed to read functions directory", {
      dir: FUNCTIONS_DIR,
      error: String(err),
    });
    return loaded;
  }

  const tsFiles = files.filter(shouldLoadFile).sort();

  for (const file of tsFiles) {
    try {
      const filePath = join(FUNCTIONS_DIR, file);
      const fileUrl = pathToFileURL(filePath).href + `?t=${Date.now()}`;
      const mod = await import(fileUrl);
      const fn = mod.default;

      if (!fn) {
        log("warn", `No default export found, skipping`, { file });
        continue;
      }

      loaded.push({ id: file.replace(/\.ts$/, ""), fn });
      log("info", `Loaded function`, { file });
    } catch (err) {
      log("error", `Failed to load function, skipping`, {
        file,
        error: String(err),
      });
    }
  }

  return loaded;
}

// --- Heartbeat function (auto-injected) ---

function createHeartbeat(functionCount: number) {
  return sidecarClient.createFunction(
    { id: "sidecar-heartbeat", name: "Sidecar Heartbeat", triggers: [{ cron: HEARTBEAT_CRON }] },
    async ({ step }) => {
      const status = await step.run("report-status", async () => {
        return {
          sidecar: "alive",
          functionCount,
          timestamp: new Date().toISOString(),
        };
      });
      return status;
    },
  );
}

// --- Connection management ---

let currentConnection: WorkerConnection | null = null;
let watcher: FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

async function startConnection() {
  const loaded = await loadFunctions();
  const heartbeat = createHeartbeat(loaded.length);
  const functions = [...loaded.map((l) => l.fn), heartbeat] as Parameters<
    typeof connect
  >[0]["apps"][0]["functions"];

  log("info", `Connecting to Inngest`, {
    functionCount: loaded.length,
    functions: loaded.map((l) => l.id),
    includesHeartbeat: true,
  });

  try {
    currentConnection = await connect({
      apps: [{ client: sidecarClient, functions }],
      handleShutdownSignals: ["SIGTERM", "SIGINT"],
    });
    log("info", `Connected to Inngest`, {
      connectionId: currentConnection.connectionId,
    });
  } catch (err) {
    log("error", `Failed to connect to Inngest`, { error: String(err) });
    throw err;
  }
}

async function reconnect() {
  log("info", "Reconnecting with updated functions...");

  if (currentConnection) {
    try {
      log("info", "Closing existing connection (draining in-flight work)...");
      await currentConnection.close();
      log("info", "Previous connection closed");
    } catch (err) {
      log("error", "Error closing previous connection", {
        error: String(err),
      });
    }
    currentConnection = null;
  }

  await startConnection();
}

function scheduleReconnect() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    reconnect().catch((err) => {
      log("error", "Reconnect failed", { error: String(err) });
    });
  }, DEBOUNCE_MS);
}

// --- File watcher ---

function startWatcher() {
  if (watcher) {
    watcher.close();
  }

  try {
    watcher = watch(FUNCTIONS_DIR, { recursive: false }, (eventType, filename) => {
      if (!filename) return;

      // Only react to .ts files that match our loading criteria
      if (!filename.endsWith(".ts") || filename.startsWith("_") || filename === "client.ts") {
        return;
      }

      log("info", `File change detected`, { eventType, filename });
      scheduleReconnect();
    });

    watcher.on("error", (err) => {
      log("error", "File watcher error", { error: String(err) });
    });

    log("info", `Watching for changes`, { dir: FUNCTIONS_DIR });
  } catch (err) {
    log("error", "Failed to start file watcher", { error: String(err) });
  }
}

// --- Main ---

async function main() {
  log("info", "Utah Sidecar starting...", {
    functionsDir: FUNCTIONS_DIR,
    debounceMs: DEBOUNCE_MS,
  });

  await ensureDir(FUNCTIONS_DIR);
  await startConnection();
  startWatcher();

  log("info", "Utah Sidecar is alive — watching for function changes");
}

main().catch((err) => {
  log("error", "Fatal error", { error: String(err) });
  process.exit(1);
});
