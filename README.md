# Inngest Agent Example — Utah

_**U**niversally **T**riggered **A**gent **H**arness_

A durable AI agent built with [Inngest](https://inngest.com) and [pi-ai](https://github.com/badlogic/pi-mono). No framework. Just a think/act/observe loop — Inngest provides durability, retries, and observability, while pi-ai provides a unified LLM interface across providers.

Simple TypeScript that gives you:

- 🔄 **Durable agent loop** — every LLM call and tool execution is an Inngest step
- 🔁 **Automatic retries** — LLM API timeouts are handled by Inngest, not your code
- 🔒 **Singleton concurrency** — one conversation at a time per chat, no race conditions
- ⚡ **Cancel on new message** — user sends again? Current run cancels, new one starts
- 📡 **Multi-channel** — Slack, Telegram, and more via a simple channel interface
- 🏠 **Local development** — runs on your machine via `connect()`, no server needed

## Architecture

```
Channel (e.g. Telegram) → Inngest Cloud (webhook + transform) → WebSocket → Local Worker → LLM (Anthropic/OpenAI/Google) → Reply Event → Channel API
```

The worker connects to Inngest Cloud via WebSocket. No public endpoint. No ngrok. No VPS. Messages flow through Inngest as events, and the agent processes them locally with full filesystem access.

## Prerequisites

- **Node.js 23+** (uses native TypeScript strip-types)
- LLM API key (e.g. **Anthropic API key** ([console.anthropic.com](https://console.anthropic.com)))
- **Inngest account** ([app.inngest.com](https://app.inngest.com))
- **At least one channel** configured (see [Channels](#channels) below)

## Setup

### 1. Create an Inngest Account

1. Sign up at [app.inngest.com](https://app.inngest.com/sign-up)
2. Go to **Settings → Keys** and copy your:
   - **Event Key** (for sending events)
   - **Signing Key** (for authenticating your worker)

### 2. Configure and Run

```bash
git clone https://github.com/inngest/agent-example-utah
cd agent-example-utah
npm install
cp .env.example .env
```

Edit `.env` with your keys:

```env
ANTHROPIC_API_KEY=sk-ant-...
INNGEST_EVENT_KEY=...
INNGEST_SIGNING_KEY=signkey-prod-...
```

Then add the environment variables for your channel(s) — see setup guides below.

Start the worker:

```bash
# Production mode (connects to Inngest Cloud via WebSocket)
npm start

# Development mode (uses local Inngest dev server)
npx inngest-cli@latest dev &
npm run dev
```

On startup, the worker automatically sets up webhooks and transforms for each configured channel.

## Channels

The agent supports multiple messaging channels. Each channel has its own setup guide:

- **[Telegram](src/channels/telegram/README.md)** — Fully automated setup. Just add your bot token and run.
- **[Slack](src/channels/slack/README.md)** — Requires creating a Slack app and configuring Event Subscriptions.

## Project Structure

```
src/
├── worker.ts                  # Entry point — connect() or serve()
├── client.ts                  # Inngest client
├── config.ts                  # Configuration from env vars
├── agent-loop.ts              # Core think → act → observe cycle
├── setup.ts                   # Channel setup orchestration
├── lib/
│   ├── llm.ts                 # pi-ai wrapper (multi-provider: Anthropic, OpenAI, Google)
│   ├── tools.ts               # Tool definitions (TypeBox schemas) + execution
│   ├── context.ts             # System prompt builder with workspace file injection
│   ├── session.ts             # JSONL session persistence
│   ├── memory.ts              # File-based memory system (daily logs + distillation)
│   └── compaction.ts          # LLM-powered conversation summarization
├── functions/
│   ├── message.ts             # Main agent function (singleton + cancelOn)
│   ├── send-reply.ts          # Channel-agnostic reply dispatch
│   ├── acknowledge-message.ts # Message acknowledgment (typing indicator, etc.)
│   ├── heartbeat.ts           # Cron-based memory maintenance
│   └── failure-handler.ts     # Global error handler with notifications
└── channels/
    ├── types.ts               # ChannelHandler interface
    ├── index.ts               # Channel registry
    ├── setup-helpers.ts       # Inngest REST API helpers for webhook setup
    └── <channel-name>/        # A channel implementation (see README for setup)
        ├── handler.ts         # ChannelHandler implementation
        ├── api.ts             # API client
        ├── setup.ts           # Webhook setup automation
        ├── transform.ts       # Webhook transform
        └── format.ts          # Formatting for channel messages
workspace/                       # Agent workspace (persisted across runs)
├── SOUL.md                    # Agent personality and behavioral guidelines
├── USER.md                    # User information
├── MEMORY.md                  # Long-term memory (agent-writable)
├── memory/                    # Daily logs (YYYY-MM-DD.md, auto-managed)
└── sessions/                  # JSONL conversation files (gitignored)
```

## How It Works

### The Agent Loop

The core is a while loop where each iteration is an Inngest step:

1. **Think** — `step.run("think")` calls the LLM via [pi-ai](https://github.com/badlogic/pi-mono)'s `complete()`
2. **Act** — if the LLM wants tools, each tool runs as `step.run("tool-read")`
3. **Observe** — tool results are fed back into the conversation
4. **Repeat** — until the LLM responds with text (no tools) or max iterations

Inngest auto-indexes duplicate step IDs in loops (`think:0`, `think:1`, etc.), so you don't need to track iteration numbers in step names.

### Event-Driven Composition

One incoming message triggers multiple independent functions:

| Function                 | Purpose                                  | Config                                    |
| ------------------------ | ---------------------------------------- | ----------------------------------------- |
| `agent-handle-message`   | Run the agent loop                       | Singleton per chat, cancel on new message |
| `acknowledge-message`    | Show "typing..." immediately             | No retries (best effort)                  |
| `send-reply`             | Format and send the response             | 3 retries, channel dispatch               |
| `agent-heartbeat`        | Distill daily logs into long-term memory | Cron (every 30 min)                       |
| `global-failure-handler` | Catch errors, notify user                | Triggered by `inngest/function.failed`    |

### Workspace Context Injection

The agent reads markdown files from the workspace directory and injects them into the system prompt:

| File        | Purpose                                                    |
| ----------- | ---------------------------------------------------------- |
| `SOUL.md`   | Agent personality, behavioral guidelines, tone, boundaries |
| `USER.md`   | Info about the user (name, timezone, preferences)          |
| `MEMORY.md` | Curated long-term memory (agent-writable)                  |

Edit these files to customize your agent's personality and knowledge. The agent can also update `MEMORY.md` using the `write` tool to remember things across conversations.

### Memory System

The agent has a two-tier memory system:

- **Daily logs** (`workspace/memory/YYYY-MM-DD.md`) — append-only notes written via the `remember` tool during conversations
- **Long-term memory** (`workspace/MEMORY.md`) — curated summary distilled from daily logs by the heartbeat function

The `agent-heartbeat` function runs on a cron schedule (default: every 30 minutes). It checks if daily logs have accumulated enough content, then uses the LLM to distill them into `MEMORY.md`. Old daily logs are pruned after a configurable retention period (default: 30 days).

### Conversation Compaction

Long conversations get summarized automatically so the agent doesn't lose context or hit token limits:

- **Token estimation**: Uses a chars/4 heuristic to estimate conversation size
- **Threshold**: Compaction triggers when estimated tokens exceed 80% of the configured max (150K)
- **LLM summarization**: Old messages are summarized into a structured checkpoint (goals, progress, decisions, next steps)
- **Recent messages preserved**: The most recent ~20K tokens of conversation are kept verbatim
- **Persisted**: The compacted session replaces the JSONL file, so it survives restarts

Compaction runs as an Inngest step (`step.run("compact")`), so it's durable and retryable.

### Context Pruning

Long tool results bloat the conversation context and cause the LLM to lose focus. The agent uses two-tier pruning:

- **Soft trim**: Tool results over 4K chars get head+tail trimmed (first 1,500 + last 1,500 chars)
- **Hard clear**: When total old tool content exceeds 50K chars, old results are replaced entirely
- **Budget warnings**: System messages are injected when iterations are running low

### Adding New Channels

The agent is channel-agnostic. Each channel implements a `ChannelHandler` interface (`src/channels/types.ts`) with methods for sending replies, acknowledging messages, and setup. Each channel directory follows the same structure:

```
src/channels/<name>/
├── handler.ts      # ChannelHandler implementation (sendReply, acknowledge)
├── api.ts          # API client for the channel's platform
├── setup.ts        # Webhook setup automation
├── transform.ts    # Plain JS transform for Inngest webhook
└── format.ts       # Markdown → channel-specific format conversion
```

To add Discord, WhatsApp, or any other channel:

1. Create a new directory under `src/channels/` following the structure above
2. Implement the `ChannelHandler` interface in `handler.ts`
3. Write a webhook transform that converts the channel's payload to `agent.message.received`
4. Register the channel in `src/channels/index.ts`

The agent loop, reply dispatch, and acknowledgment functions are all channel-agnostic — no changes needed outside `src/channels/`.

## Key Inngest Features Used

- **[`connect()`](https://www.inngest.com/docs/setup/connect)** — WebSocket-based worker
- **[Singleton execution](https://www.inngest.com/docs/guides/singleton)** — one run per chat at a time
- **[Step retries](https://www.inngest.com/docs/guides/error-handling)** — automatic retry on LLM API failures
- **[Event-driven functions](https://www.inngest.com/docs/features/inngest-functions)** — compose behavior from small focused functions
- **[Webhook transforms](https://www.inngest.com/docs/platform/webhooks)** — convert external payloads to typed events
- **[Checkpointing](https://www.inngest.com/docs/setup/checkpointing)** — near-zero inter-step latency

## Acknowledgments

This project uses [pi-ai](https://github.com/badlogic/pi-mono) (`@mariozechner/pi-ai`) by [Mario Zechner](https://github.com/badlogic) for its unified LLM interface and `@mariozechner/pi-coding-agent` for it's. standard tools. pi-ai provides a single `complete()` function that works across Anthropic, OpenAI, Google, and other providers — making it easy to swap models without changing any agent code. It's a great library.

## License

Apache-2.0
