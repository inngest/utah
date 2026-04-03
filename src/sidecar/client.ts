// Load an initialize this before any other code to start trace collection
import { extendedTracesMiddleware } from "inngest/experimental";
const extendedTraces = extendedTracesMiddleware();

import { Inngest } from "inngest";
import { logger } from "../lib/logger.ts";

export const inngest = new Inngest({
  id: "utah-sidecar",
  middleware: [extendedTraces],
  logger,
});
