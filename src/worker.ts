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
import { subAgent } from "./functions/sub-agent.ts";
import { ensureWorkspace } from "./lib/session.ts";
import { setup } from "./setup.ts";
import { config } from "./config.ts";
import { logger } from "./lib/logger.ts";
import { getConfiguredModel, getFallbackModel } from "./lib/llm.ts";

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

  // Validate configured models early so we fail fast on misconfiguration
  getConfiguredModel();
  const fallback = getFallbackModel();

  logger.info(
    {
      agent: config.agent.name,
      model: `${config.llm.provider}/${config.llm.model}`,
      fallbackModel: fallback
        ? `${config.llm.fallbackProvider}/${config.llm.fallbackModel}`
        : undefined,
      workspace: config.workspace.root,
      functions: functions.length,
    },
    `${config.agent.name} starting...`,
  );

  await connect({
    apps: [{ client: inngest, functions }],
    handleShutdownSignals: ["SIGTERM", "SIGINT"],
  });
  logger.info(`${config.agent.name} is alive — Inngest WebSocket connected`);
}

main().catch((e) => {
  logger.fatal(e, "Fatal error");
  process.exit(1);
});
