# Sidecar

The sidecar is a standalone process that dynamically loads Inngest functions from disk and connects them to Inngest via WebSocket. It runs independently from the core agent and is how Utah gains new capabilities at runtime — scheduled jobs, event handlers, multi-step workflows — without modifying source code.

## Architecture

```
Core Agent (worker.ts)          Sidecar (sidecar.ts)
├─ Inngest app: "ai-agent"      ├─ Inngest app: "utah-sidecar"
├─ Fixed functions:              ├─ Dynamic functions:
│  handleMessage                 │  loaded from workspace/functions/*.ts
│  sendReply                     ├─ Auto-injected heartbeat (every 30m)
│  subAgent, etc.                ├─ File watcher → auto-reconnect
└─ connect() to Inngest          └─ connect() to Inngest
```

Both processes connect to Inngest independently. They communicate via events — a sidecar function can message the main agent by sending `agent.message.received`.

## Key files

- `src/sidecar/sidecar.ts` — entry point, function loader, file watcher, connection management
- `src/sidecar/client.ts` — shared Inngest client (`id: "utah-sidecar"`) imported by all function files
- `workspace/functions/` — user-writable directory where function files live

## How function loading works

1. `loadFunctions()` reads `workspace/functions/`, filters for `.ts` files (skipping `_`-prefixed and `client.ts`)
2. Each file is dynamically imported with a `?t={timestamp}` cache-busting query to bypass Node's module cache
3. The `default` export of each file is collected as an Inngest function
4. A heartbeat function is auto-injected alongside user functions
5. All functions are passed to `connect()` which opens a WebSocket to Inngest

## Hot reload

A `fs.watch()` on `workspace/functions/` detects file changes. On change:

1. 2-second debounce (prevents thrashing on rapid saves)
2. Gracefully closes the existing WebSocket connection
3. Re-runs `loadFunctions()` and opens a new connection

No process restart needed — the agent can `write` a new function file and the sidecar picks it up automatically.

## Running

```bash
pnpm run sidecar      # Production — connects to Inngest Cloud
pnpm run sidecar:dev  # Dev — INNGEST_DEV=1 + node --watch (restarts on src/ changes)
```

`sidecar:dev` uses Node's `--watch` flag to restart when _source_ files (`src/sidecar/`) change. This is separate from the internal file watcher which handles _function_ file (`workspace/functions/`) changes without a restart.

## Function file conventions

Each file in `workspace/functions/` must:

- Default-export an `inngest.createFunction()` call
- Import the client from `../../src/sidecar/client.js` (`.js` extension required)
- Avoid `enum`/`namespace` (incompatible with `--experimental-strip-types`)
- Have no top-level side effects (files may be re-imported on reload)
