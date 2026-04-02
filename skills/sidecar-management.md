---
name: Sidecar Management
description: How to create, update, and manage dynamic Inngest functions in the sidecar process (cron jobs, event handlers, workflows).
---

# Sidecar Management

The sidecar is a separate process that dynamically loads Inngest functions from `workspace/functions/` and connects them to Inngest via WebSocket. Use it to add scheduled automations, event-driven handlers, and multi-step workflows without modifying the core agent.

## How It Works

1. The sidecar scans `workspace/functions/` for `.ts` files on startup
2. Each file must have a **default export** of an `inngest.createFunction()` call
3. A file watcher detects changes and automatically reconnects with the updated function list (2s debounce)
4. All functions share the `utah-sidecar` Inngest app ID via the shared client

## Writing a Function

Read the **Inngest Functions** skill (`skills/inngest-functions.md`) for the full function template, file conventions, trigger types, step API reference, and common patterns.

Key difference for sidecar functions: import the client from `../../src/sidecar/client.js` (not `./client.js` as shown in the skill template — the relative path differs because sidecar functions live in `workspace/functions/`).

## File Operations

### Creating a new function

Use the `write` tool to create a file in `workspace/functions/`:

```
write workspace/functions/my-function.ts <content>
```

The sidecar's file watcher will detect the new file and reconnect automatically within 2 seconds.

### Updating an existing function

Use the `edit` tool to modify the file. The file watcher triggers a reconnect on save.

### Deleting a function

Use `bash` to remove the file:

```
rm workspace/functions/my-function.ts
```

The sidecar reconnects without the deleted function.

### Listing active functions

```
ls workspace/functions/
```

All `.ts` files (except `_`-prefixed and `client.ts`) are loaded as functions.

## No Manual Restart Needed

The sidecar watches `workspace/functions/` and reconnects automatically when files change. You do not need to restart the sidecar process after writing, editing, or deleting function files.

If the sidecar is not running, it can be started with:

- **Dev mode**: `pnpm run sidecar:dev` (auto-restarts on source changes)
- **Production**: `pnpm run sidecar` (connects to Inngest Cloud)

## Notifying the Main Agent

Sidecar functions can message the main agent by sending an `agent.message.received` event:

```typescript
await step.sendEvent("alert-agent", {
  name: "agent.message.received",
  data: {
    channel: "system",
    sessionKey: "system-alerts",
    message: `Alert: something happened`,
  },
});
```
