/**
 * Worker — registers Inngest functions and connects via WebSocket or HTTP.
 *
 * Production: connect() — persistent WebSocket to Inngest Cloud, no public endpoint.
 * Development: serve() — HTTP server for the local Inngest dev server.
 */

import { inngest } from "./client.ts";
import { handleMessage } from "./functions/message.ts";
import { sendReply } from "./functions/send-reply.ts";
import { acknowledgeMessage } from "./functions/acknowledge-message.ts";
import { failureHandler } from "./functions/failure-handler.ts";
import { heartbeat } from "./functions/heartbeat.ts";
import { subAgent } from "./functions/sub-agent.ts";
import { ensureWorkspace } from "./lib/session.ts";
import { setup } from "./setup.ts";
import { config } from "./config.ts";

const functions = [
  handleMessage,
  sendReply,
  acknowledgeMessage,
  failureHandler,
  heartbeat,
  subAgent,
];

async function main() {
  await ensureWorkspace(config.workspace.root);

  // Ensure Inngest webhook + Telegram webhook are configured
  await setup();

  console.log(`🤖 ${config.agent.name} starting...`);
  console.log(`   Model: ${config.llm.provider}/${config.llm.model}`);
  console.log(`   Workspace: ${config.workspace.root}`);
  console.log(`   Functions: ${functions.length}`);

  const isDev = process.env.INNGEST_DEV === "1";

  if (isDev) {
    const { serve } = await import("inngest/express");
    const express = (await import("express")).default;
    const app = express();
    app.use(express.json());
    app.use("/api/inngest", serve({ client: inngest, functions }));

    const port = parseInt(process.env.PORT || "3002");
    app.listen(port, () => {
      console.log(`   Inngest: http://localhost:${port}/api/inngest (dev mode)`);
      console.log(`\n✅ ${config.agent.name} is alive (dev)\n`);
    });
  } else {
    const { connect } = await import("inngest/connect");
    await connect({ apps: [{ client: inngest, functions }] });
    console.log(`   Inngest: WebSocket connected (production)`);
    console.log(`\n✅ ${config.agent.name} is alive\n`);
  }

  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
