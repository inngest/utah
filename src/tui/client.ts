/**
 * Dedicated Inngest client for the standalone TUI process.
 *
 * Deliberately separate from src/client.ts: that client wires up a pino logger
 * that writes to stdout and OTel tracing middleware — both of which would
 * corrupt a full-screen terminal UI. Here we use a silent logger and no
 * middleware. Events are routed by name, so this client's id only namespaces
 * the (non-existent) functions it registers, not the events it sends.
 *
 * Dev vs cloud is controlled the same way as the worker: set INNGEST_DEV=1 to
 * talk to a local dev server, otherwise it uses INNGEST_EVENT_KEY /
 * INNGEST_SIGNING_KEY against Inngest Cloud.
 */

import { Inngest } from "inngest";
import pino from "pino";

// level: "silent" guarantees nothing reaches stdout/stderr while the TUI owns
// the terminal. Bump LOG_LEVEL if you need to debug the client.
const silentLogger = pino({ level: process.env.TUI_LOG_LEVEL || "silent" });

export const inngest = new Inngest({
  id: "utah-tui",
  logger: silentLogger,
});
