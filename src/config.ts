import { resolve } from "path";

export const config = {
  agent: {
    name: process.env.AGENT_NAME || "Utah",
    model: process.env.AGENT_MODEL || "claude-opus-4-6",
  },

  workspace: {
    root: resolve(process.env.AGENT_WORKSPACE || "./workspace"),
    sessionDir: "sessions",
    memoryFile: "MEMORY.md",
    memoryDir: "memory",
  },

  llm: {
    anthropicKey: process.env.ANTHROPIC_API_KEY || "",
    maxTokens: 4096,
  },

  loop: {
    maxIterations: 20,
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    allowedChatIds: (process.env.TELEGRAM_ALLOWED_CHATS || "")
      .split(",")
      .filter(Boolean),
  },
};
