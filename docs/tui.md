# Utah TUI

A standalone terminal UI for chatting with the agent, built on Inngest Realtime.
It is also a regular [channel](../src/channels/tui/) — the worker replies to it
the same way it replies to Slack or Telegram.

## Running

```bash
pnpm tui        # talk to Inngest Cloud (needs INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY)
pnpm tui:dev    # talk to a local dev server (INNGEST_DEV=1)
```

The worker must be running too (`pnpm start` or `pnpm dev`) so there's something
to handle the messages.

```bash
pnpm tui -- <sessionId>   # resume a specific session
pnpm tui -- --new         # force a fresh session
```

With no argument it resumes your most recent session, or creates one.

## How it works

```
TUI ──inngest.send(agent.message.received)──▶ Inngest ──▶ agent loop
TUI ◀──subscribe(tui:<sessionId>)──── inngest.realtime.publish() ◀── send-reply
```

1. You type a line; the CLI sends an `agent.message.received` event directly
   (it's a trusted local client with the event key — no webhook needed).
2. The agent loop runs on the worker. The TUI channel handler publishes replies
   and a `thinking`/`idle` status to the realtime channel `tui:<sessionId>`.
3. The CLI mints a subscription token with its credentials and subscribes to
   that channel, rendering replies as they arrive.

Set `AGENT_INCREMENTAL_REPLIES=true` for streaming progress (text the model
emits between tool calls); otherwise you just get the final answer.

## Sessions and state

State lives in `~/.inngest-agent/`:

- `index.json` — all known sessions (id, timestamps, title). Multiple terminal
  windows can each run their own session simultaneously.
- `sessions/<id>.jsonl` — a local copy of each session's transcript, so a window
  can reload its history on restart. (The authoritative history is server-side.)

The session id is both the realtime channel suffix and the agent's `sessionKey`,
so each window's realtime stream only carries its own replies.

## Commands

| Command          | Action                                 |
| ---------------- | -------------------------------------- |
| `/clear`, `/new` | end this session and start a fresh one |
| `/sessions`      | list known sessions                    |
| `/help`          | show help                              |
| `/exit`, `/quit` | quit                                   |

## Keys

- `Ctrl+C` — clear the input (press again on an empty line to exit)
- `Ctrl+L` — redraw · `Ctrl+U` — clear line
- `↑` / `↓` — input history · `PgUp` / `PgDn` — scroll the transcript
