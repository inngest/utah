# TUI channel

A terminal channel that talks to the agent over **Inngest Realtime** instead of
an external messaging API. It powers the standalone CLI in [`src/tui/`](../../tui/).

## How it differs from other channels

|          | Telegram / Slack            | TUI                                         |
| -------- | --------------------------- | ------------------------------------------- |
| Inbound  | Inngest webhook + transform | CLI sends `agent.message.received` directly |
| Outbound | HTTP API call               | `inngest.realtime.publish()`                |
| Setup    | webhook registration        | none                                        |

Because the CLI is a trusted local client (it has the Inngest keys), it sends
events itself — there is no webhook, transform, or `setup()`.

## Wiring

- **`channel.ts`** — the realtime channel definition `tui:<sessionId>` with two
  topics: `reply` (`{ content, final }`) and `status` (`{ state }`). It imports
  only from `inngest/realtime`, so the CLI can import it without dragging the
  worker's stdout logger into the terminal process.
- **`handler.ts`** — implements `ChannelHandler`. `sendReply` publishes the
  agent's response to `tui:<sessionId>.reply`; `acknowledge` publishes a
  `thinking` status. The session id travels in `destination.chatId`.

## Replies and streaming

The final answer is always published with `final: true`. When
`AGENT_INCREMENTAL_REPLIES=true`, the agent loop also emits the text it produces
between tool calls; those arrive tagged with `channelMeta.incremental` and are
published with `final: false`, so the TUI renders them as in-progress text.

## Run it

```bash
pnpm tui        # cloud (uses INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY)
pnpm tui:dev    # local dev server (INNGEST_DEV=1)
```
