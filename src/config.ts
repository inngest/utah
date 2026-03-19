import { resolve } from "path";
import type { KnownProvider } from "@mariozechner/pi-ai";

export const config = {
  agent: {
    name: process.env.AGENT_NAME || "Utah",
  },

  workspace: {
    root: resolve(process.env.AGENT_WORKSPACE || "./workspace"),
    sessionDir: "sessions",
    memoryFile: "MEMORY.md",
    memoryDir: "memory",
  },

  llm: {
    // pi-ai provider/model format — supports "anthropic", "openai", "google"
    provider: (process.env.LLM_PROVIDER || "anthropic") as KnownProvider,
    model: process.env.AGENT_MODEL || "claude-sonnet-4-20250514",
    // API keys are read from env by pi-ai automatically:
    //   ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY

    // Optional fallback provider/model — used on later retry attempts if primary fails
    fallbackProvider: (process.env.FALLBACK_LLM_PROVIDER || undefined) as KnownProvider | undefined,
    fallbackModel: process.env.FALLBACK_AGENT_MODEL as string | undefined,
  },

  loop: {
    maxIterations: 20,
  },

  compaction: {
    // Estimated token limit before compaction triggers
    maxTokens: 150_000,
    // Compact when estimated tokens exceed this fraction of maxTokens
    threshold: 0.8,
    // Keep this many estimated tokens of recent messages verbatim
    keepRecentTokens: 20_000,
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    allowedChatIds: (process.env.TELEGRAM_ALLOWED_CHATS || "").split(",").filter(Boolean),
  },

  slack: {
    botToken: process.env.SLACK_BOT_TOKEN || "",
    signingSecret: process.env.SLACK_SIGNING_SECRET || "",
  },

  incrementalReplies: process.env.AGENT_INCREMENTAL_REPLIES === "true",
};
