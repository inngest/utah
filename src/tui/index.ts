/**
 * Entry point for the standalone Utah TUI.
 *
 *   pnpm tui                 start (or resume the most recent) session
 *   pnpm tui -- <sessionId>  resume a specific session
 *   pnpm tui -- --new        force a fresh session
 *
 * Requires INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY (or INNGEST_DEV=1 for a
 * local dev server) so it can send events and subscribe to realtime.
 */

import { App } from "./app.ts";
import { listSessions } from "./state.ts";
import { installConsoleCapture } from "./log.ts";

async function main() {
  if (!process.stdin.isTTY) {
    console.error("The Utah TUI requires an interactive terminal (TTY).");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  let sessionId: string | undefined;
  if (!args.includes("--new")) {
    // Resume an explicitly named session, else the most recent one.
    sessionId = args.find((a) => !a.startsWith("-")) ?? (await listSessions())[0]?.id;
  }

  // Route console.* to the log file so SDK output can't corrupt the UI.
  installConsoleCapture();

  const app = new App();
  await app.start(sessionId);
}

main().catch((err) => {
  // Restore the terminal before reporting (App.start may have failed early).
  process.stdout.write("\x1b[?25h\x1b[?1049l");
  console.error("Fatal error starting TUI:", err);
  process.exit(1);
});
