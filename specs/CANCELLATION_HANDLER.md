# Global Cancellation Handler

## Context

The `agent-handle-message` function uses `singleton` (with `mode: "cancel"`) to cancel the current run when a new message arrives in the same session. Currently, cancellation happens silently — the user gets no acknowledgment that their new message was received and the agent is starting over. Adding a cancellation handler sends a short reply like "Got it, let me reconsider..." so the user knows their follow-up was picked up.

## Plan

### 1. Create `src/functions/cancellation-handler.ts`

Follow the same pattern as `src/functions/failure-handler.ts`:

- Listen for `inngest/function.cancelled` lifecycle event
- Filter to only handle cancellations of `agent-handle-message` (via `data.function_id`)
- Extract the original event from `data.event` (same shape as the failure handler's payload)
- Get `channel`, `destination`, and `channelMeta` from the original event data
- Use `getChannel(channel).sendReply()` directly (not emitting `agent.reply.ready`) to send a short message
- Config: `retries: 1` (best-effort, same as failure handler)

Message: something like _"Got it, let me reconsider with the new context..."_

### 2. Register in `src/worker.ts`

Import `cancellationHandler` and add it to the `functions` array.

## Key files

- `src/functions/failure-handler.ts` — pattern to follow
- `src/functions/send-reply.ts` — reference for `getChannel()` + `sendReply()` usage
- `src/channels/index.ts` — `getChannel()` export
- `src/worker.ts` — function registration

## Notes

- The `inngest/function.cancelled` TypeScript types don't explicitly include `data.event`, but at runtime it should be present (consistent with `inngest/function.failed`). Null guards ensure silent no-op if the shape differs.
- There's a minor race where the cancellation notice and the new response could arrive close together. This is acceptable since the notice is short and intentional.

## Verification

1. Run the worker locally with `inngest dev`
2. Send a message, then quickly send a follow-up before the agent finishes
3. Confirm the cancellation notice appears in the conversation, followed by the new response
