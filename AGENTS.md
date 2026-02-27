# AGENTS.md

A durable AI agent built with Inngest + pi-ai. Think/act/observe loop with multi-channel messaging (Slack, Telegram). No framework — just TypeScript.

## Stack

- **Runtime**: Node.js 23+ (native `--experimental-strip-types`, no build step)
- **Package manager**: pnpm
- **LLM interface**: pi-ai (`@mariozechner/pi-ai`) — unified `complete()` across Anthropic, OpenAI, Google
- **Durability**: Inngest — every LLM call and tool execution is a `step.run()`
- **Schemas**: TypeBox (`@sinclair/typebox`) for tool parameter validation

## Commands

```bash
pnpm install          # Install dependencies
pnpm run dev          # Dev mode (local Inngest dev server, file watching)
pnpm run start        # Production mode (connects to Inngest Cloud via WebSocket)
pnpm run typecheck    # Type check with tsc --noEmit
```

No test runner is configured. There is no build step — Node runs TypeScript directly.

## Architecture

**Event flow**: Channel webhook → Inngest event (`agent.message.received`) → agent loop → reply event (`agent.reply.ready`) → channel handler

**Key patterns**:
- The agent loop (`src/agent-loop.ts`) is a while loop where each iteration is an Inngest step
- Every Inngest function is in `src/functions/` — each file exports one function
- Channels implement the `ChannelHandler` interface (`src/channels/types.ts`) with `sendReply`, `acknowledge`, and optional `setup`
- Workspace files (`workspace/SOUL.md`, `USER.md`, `MEMORY.md`) are injected into the system prompt
- Tool definitions live in `src/lib/tools.ts` using TypeBox schemas

**Adding a channel**: Create `src/channels/<name>/` with `handler.ts`, `api.ts`, `setup.ts`, `transform.ts`, `format.ts`, then register in `src/channels/index.ts`. No changes needed outside `src/channels/`.

## Conventions

- ESM only (`"type": "module"` in package.json), use `.ts` extensions in imports
- No build artifacts — `tsconfig.json` has `noEmit: true`
- Config is loaded from env vars via `src/config.ts`
- Workspace files in `workspace/` are agent-writable at runtime; source files in `src/` are not
