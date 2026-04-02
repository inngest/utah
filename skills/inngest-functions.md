# Inngest Functions — Sidecar Reference

How to create dynamic Inngest functions that the sidecar loads automatically.

## File Conventions

- **One function per file** in the `functions/` directory
- **Default export** — each file must `export default` an Inngest function
- **Import the shared client** from `./client.js` (not `./client.ts`)
- **`_`-prefixed files are ignored** — use them for helpers (e.g. `_utils.ts`)
- **`client.ts` is ignored** — it's the shared client, not a function
- **No top-level side effects** — the file may be re-imported on changes
- **No `enum` or `namespace`** — not supported with `--experimental-strip-types`

## Basic Template

```typescript
import { inngest } from "./client.js";

export default inngest.createFunction(
  { id: "my-function", name: "My Function" },
  { event: "app/my-event" }, // or { cron: "..." }
  async ({ event, step }) => {
    // function body
  },
);
```

## Trigger Types

### Cron Trigger

```typescript
{
  cron: "0 */6 * * *";
} // Every 6 hours
{
  cron: "*/30 * * * *";
} // Every 30 minutes
{
  cron: "0 9 * * 1-5";
} // Weekdays at 9am UTC
{
  cron: "TZ=America/Detroit 0 9 * * *";
} // 9am Eastern
{
  cron: "TZ=America/Detroit 0 18 * * 1-5";
} // 6pm ET weekdays
```

### Event Trigger

```typescript
{
  event: "app/user.created";
} // Single event
{
  event: "app/order.completed";
} // Any custom event name
```

## Step API Quick Reference

### `step.run(id, fn)` — Execute a durable step

```typescript
const result = await step.run("fetch-data", async () => {
  const res = await fetch("https://api.example.com/data");
  return res.json();
});
```

### `step.sleep(id, duration)` — Sleep for a duration

```typescript
await step.sleep("wait-a-bit", "1h"); // 1 hour
await step.sleep("pause", "30m"); // 30 minutes
await step.sleep("brief", "10s"); // 10 seconds
await step.sleep("long", "7d"); // 7 days
```

### `step.sleepUntil(id, timestamp)` — Sleep until a specific time

```typescript
await step.sleepUntil("wait-until", "2026-04-15T09:00:00Z");
await step.sleepUntil("wait-until", new Date("2026-04-15T09:00:00Z"));
```

### `step.waitForEvent(id, opts)` — Wait for a matching event

```typescript
const event = await step.waitForEvent("wait-for-approval", {
  event: "app/approval.received",
  timeout: "24h",
  match: "data.orderId", // match on event.data.orderId
});
// Returns the event or null if timed out
```

### `step.sendEvent(id, event)` — Send an event

```typescript
await step.sendEvent("notify", {
  name: "app/task.completed",
  data: { taskId: "123", result: "success" },
});
```

### `step.invoke(id, opts)` — Invoke another function and wait for result

```typescript
const result = await step.invoke("call-other", {
  function: otherFunction, // reference to the function
  data: { input: "value" },
});
```

## Event Naming Conventions

Use slash-delimited namespaces with dot-separated specifics:

```
app/user.created
app/order.completed
agent/task.finished
sidecar/health.check
```

## Common Patterns

### Cron Job

```typescript
import { inngest } from "./client.js";

export default inngest.createFunction(
  { id: "daily-cleanup", name: "Daily Cleanup" },
  { cron: "TZ=America/Detroit 0 3 * * *" }, // 3am ET daily
  async ({ step }) => {
    const result = await step.run("cleanup", async () => {
      // do cleanup work
      return { cleaned: 42 };
    });
    return result;
  },
);
```

### Event Handler

```typescript
import { inngest } from "./client.js";

export default inngest.createFunction(
  { id: "handle-webhook", name: "Handle Webhook" },
  { event: "app/webhook.received" },
  async ({ event, step }) => {
    const processed = await step.run("process", async () => {
      return { webhookId: event.data.id, status: "processed" };
    });
    return processed;
  },
);
```

### Multi-Step Workflow

```typescript
import { inngest } from "./client.js";

export default inngest.createFunction(
  { id: "onboarding-flow", name: "Onboarding Flow" },
  { event: "app/user.signed-up" },
  async ({ event, step }) => {
    await step.run("send-welcome", async () => {
      // send welcome email
    });

    await step.sleep("wait-1-day", "1d");

    await step.run("send-tips", async () => {
      // send tips email
    });

    const feedback = await step.waitForEvent("wait-for-feedback", {
      event: "app/feedback.received",
      match: "data.userId",
      timeout: "7d",
    });

    if (feedback) {
      await step.run("process-feedback", async () => {
        // handle feedback
      });
    }
  },
);
```

### Notify the Main Agent

```typescript
import { inngest } from "./client.js";

export default inngest.createFunction(
  { id: "monitor-something", name: "Monitor Something" },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    const result = await step.run("check", async () => {
      // check something
      return { needsAttention: true, details: "..." };
    });

    if (result.needsAttention) {
      await step.sendEvent("alert-agent", {
        name: "agent.message.received",
        data: {
          channel: "system",
          sessionKey: "system-alerts",
          message: `Alert: ${result.details}`,
        },
      });
    }
  },
);
```
