import { resolve } from "path";

export const config = {
  agent: {
    name: process.env.AGENT_NAME || "Utah",
  },

  workspace: {
    root: resolve(process.env.AGENT_WORKSPACE || "./workspace"),
    sessionDir: "sessions",
  },

  llm: {
    // pi-ai provider/model format — supports "anthropic", "openai", "google"
    provider: (process.env.LLM_PROVIDER || "anthropic") as "anthropic" | "openai" | "google",
    model: process.env.AGENT_MODEL || "claude-sonnet-4-20250514",
    // API keys are read from env by pi-ai automatically:
    //   ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY
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
    allowedChatIds: (process.env.TELEGRAM_ALLOWED_CHATS || "")
      .split(",")
      .filter(Boolean),
  },
};
