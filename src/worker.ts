/**
 * Worker — registers Inngest functions and connects via WebSocket.
 */
// Load the Inngest client w/ extended traces before anything else
import { inngest } from "./client.ts";
import { connect } from "inngest/connect";
import { handleMessage } from "./functions/message.ts";
import { sendReply } from "./functions/send-reply.ts";
import { acknowledgeMessage } from "./functions/acknowledge-message.ts";
import { failureHandler } from "./functions/failure-handler.ts";
import { heartbeat } from "./functions/heartbeat.ts";
import { ensureWorkspace } from "./lib/session.ts";
import { setup } from "./setup.ts";
import { config } from "./config.ts";

const functions = [
  handleMessage,
  sendReply,
  acknowledgeMessage,
  failureHandler,
  heartbeat,
];

async function main() {
  await ensureWorkspace(config.workspace.root);

  // Ensure Inngest webhook + Telegram webhook are configured
  await setup();

  console.log(`🤖 ${config.agent.name} starting...`);
  console.log(`   Model: ${config.llm.provider}/${config.llm.model}`);
  console.log(`   Workspace: ${config.workspace.root}`);
  console.log(`   Functions: ${functions.length}`);

  await connect({
    apps: [{ client: inngest, functions }],
    handleShutdownSignals: ["SIGTERM", "SIGINT"],
  });
  console.log(`   Inngest: WebSocket connected`);
  console.log(`\n✅ ${config.agent.name} is alive\n`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
