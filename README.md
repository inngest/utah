# Inngest Agent Example — Utah

A durable AI agent built with [Inngest](https://inngest.com). No framework. No LangChain. Just a think/act/observe loop with Inngest steps for durability, retries, and observability.

**~1,000 lines of TypeScript** that gives you:

- 🔄 **Durable agent loop** — every LLM call and tool execution is an Inngest step
- 🔁 **Automatic retries** — LLM API timeouts are handled by Inngest, not your code
- 🔒 **Singleton concurrency** — one conversation at a time per chat, no race conditions
- ⚡ **Cancel on new message** — user sends again? Current run cancels, new one starts
- 📡 **Telegram integration** — webhook transforms + reply functions, all event-driven
- 🏠 **Local development** — runs on your machine via `connect()`, no server needed

## Architecture

```
Telegram → Inngest Cloud (webhook + transform) → WebSocket → Local Worker → Anthropic → Reply Event → Telegram API
```

The worker connects to Inngest Cloud via WebSocket. No public endpoint. No ngrok. No VPS. Messages flow through Inngest as events, and the agent processes them locally with full filesystem access.

## Prerequisites

- **Node.js 23+** (uses native TypeScript strip-types)
- **Anthropic API key** ([console.anthropic.com](https://console.anthropic.com))
- **Inngest account** ([app.inngest.com](https://app.inngest.com))
- **Telegram bot** (created via [@BotFather](https://t.me/BotFather))

## Setup

### 1. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token (looks like `123456:ABC-DEF...`)
4. Send `/setprivacy` → select your bot → `Disable` (so the bot receives all messages in groups)

### 2. Create an Inngest Account

1. Sign up at [app.inngest.com](https://app.inngest.com/sign-up)
2. Go to **Settings → Keys** and copy your:
   - **Event Key** (for sending events)
   - **Signing Key** (for authenticating your worker)

### 3. Set Up the Webhook Transform

This is what connects Telegram to your agent. Telegram sends raw webhook payloads to Inngest, and a transform converts them into typed agent events.

1. In the Inngest dashboard, go to **Settings → Webhooks → Add Webhook**
2. Enable the **Transform** toggle
3. Paste the transform function from [`src/transforms/telegram.ts`](src/transforms/telegram.ts) (the plain JS version in the comment block)
4. Save and copy the **Webhook URL**

### 4. Point Telegram at Inngest

Tell Telegram to send updates to your Inngest webhook:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "<YOUR_INNGEST_WEBHOOK_URL>"}'
```

You should see `{"ok": true, "result": true, "description": "Webhook was set"}`.

### 5. Configure and Run

```bash
git clone https://github.com/inngest/agent-example-utah
cd agent-example-utah
npm install
cp .env.example .env
```

Edit `.env` with your keys:

```env
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=123456:ABC...
INNGEST_EVENT_KEY=...
INNGEST_SIGNING_KEY=signkey-prod-...
```

Start the worker:

```bash
# Production mode (connects to Inngest Cloud via WebSocket)
npm start

# Development mode (uses local Inngest dev server)
npx inngest-cli@latest dev &
npm run dev
```

Send a message to your bot on Telegram. You should see the agent process it in the terminal and reply.

## Project Structure

```
src/
├── worker.ts              # Entry point — connect() or serve()
├── client.ts              # Inngest client
├── config.ts              # Configuration from env vars
├── agent-loop.ts          # Core think → act → observe cycle
├── lib/
│   ├── llm.ts             # pi-ai wrapper (multi-provider: Anthropic, OpenAI, Google)
│   ├── tools.ts           # Tool definitions (TypeBox schemas) + execution
│   ├── context.ts         # System prompt builder with workspace file injection
│   ├── session.ts         # JSONL session persistence
│   └── compaction.ts      # LLM-powered conversation summarization
├── functions/
│   ├── message.ts         # Main agent function (singleton + cancelOn)
│   ├── telegram-reply.ts  # Send responses to Telegram (with HTML fallback)
│   ├── telegram-typing.ts # Typing indicator (fire-and-forget)
│   └── failure-handler.ts # Global error handler with Telegram notifications
└── transforms/
    └── telegram.ts        # Webhook transform (paste into Inngest dashboard)
workspace/                   # Agent workspace (persisted across runs)
├── IDENTITY.md            # Agent identity and personality
├── SOUL.md                # Behavioral guidelines
├── USER.md                # User information
├── MEMORY.md              # Long-term memory (agent-writable)
└── sessions/              # JSONL conversation files (gitignored)
```

## How It Works

### The Agent Loop

The core is a while loop where each iteration is an Inngest step:

1. **Think** — `step.run("think")` calls the LLM via pi-ai's `complete()`
2. **Act** — if the LLM wants tools, each tool runs as `step.run("tool-read_file")`
3. **Observe** — tool results are fed back into the conversation
4. **Repeat** — until the LLM responds with text (no tools) or max iterations

Inngest auto-indexes duplicate step IDs in loops (`think:0`, `think:1`, etc.), so you don't need to track iteration numbers in step names.

### Event-Driven Composition

One incoming message triggers multiple independent functions:

| Function | Purpose | Config |
|---|---|---|
| `agent-handle-message` | Run the agent loop | Singleton per chat, cancel on new message |
| `telegram-typing-indicator` | Show "typing..." immediately | No retries (best effort) |
| `telegram-send-reply` | Format and send the response | 3 retries, HTML fallback |
| `global-failure-handler` | Catch errors, notify user | Triggered by `inngest/function.failed` |

### Workspace Context Injection

The agent reads markdown files from the workspace directory and injects them into the system prompt:

| File | Purpose |
|---|---|
| `IDENTITY.md` | Agent name, role, personality |
| `SOUL.md` | Behavioral guidelines, tone, boundaries |
| `USER.md` | Info about the user (name, timezone, preferences) |
| `MEMORY.md` | Long-term memory the agent can read and update |

Edit these files to customize your agent's personality and knowledge. The agent can also update `MEMORY.md` using the `write_file` tool to remember things across conversations.

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

The agent is channel-agnostic. To add Slack, Discord, or any other channel:

1. Create a webhook transform that converts the channel's payload to `agent.message.received`
2. Create a reply function that listens for `agent.reply.ready` with a channel filter
3. That's it — the agent loop doesn't change

## Key Inngest Features Used

- **[`connect()`](/docs/reference/serve#connect)** — WebSocket connection for local development
- **[Singleton concurrency](/docs/guides/concurrency)** — one run per chat at a time
- **[`cancelOn`](/docs/guides/cancel)** — cancel active run when user sends a new message
- **[Step retries](/docs/guides/error-handling)** — automatic retry on LLM API failures
- **[Event-driven functions](/docs/features/inngest-functions)** — compose behavior from small focused functions
- **[Webhook transforms](/docs/platform/webhooks)** — convert external payloads to typed events
- **[Checkpointing](/docs/setup/checkpointing)** — near-zero inter-step latency

## License

MIT
