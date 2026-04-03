---
name: Inngest Functions
description: How to create dynamic Inngest functions that the sidecar loads automatically.
---

# Inngest Functions — Sidecar Reference

How to create dynamic Inngest functions that the sidecar loads automatically.

## File Conventions

- **One function per file** in the `{workspace.root}/functions/` directory (workspace root is configured in `src/config.ts`)
- **Default export** — each file must `export default` an Inngest function
- **Import the shared client** from `../../src/sidecar/client.ts`
- **`_`-prefixed files are ignored** — use them for helpers (e.g. `_utils.ts`)
- **`client.ts` is ignored** — it's the shared client, not a function
- **No top-level side effects** — the file may be re-imported on changes
- **No `enum` or `namespace`** — not supported with `--experimental-strip-types`

## Basic Template

```typescript
import { inngest } from "../../src/sidecar/client.ts";

export default inngest.createFunction(
  { id: "my-function", name: "My Function", triggers: [{ event: "app/my-event" }] },
  async ({ event, step }) => {
    // function body
  },
);
```

## Trigger Types

Triggers are defined in the `triggers` array within the function options object. You can specify one or multiple triggers.

### Cron Trigger

```typescript
{
  triggers: [{ cron: "0 */6 * * *" }];
} // Every 6 hours
{
  triggers: [{ cron: "*/30 * * * *" }];
} // Every 30 minutes
{
  triggers: [{ cron: "0 9 * * 1-5" }];
} // Weekdays at 9am UTC
{
  triggers: [{ cron: "TZ=America/Detroit 0 9 * * *" }];
} // 9am Eastern
{
  triggers: [{ cron: "TZ=America/Detroit 0 18 * * 1-5" }];
} // 6pm ET weekdays
```

### Event Trigger

```typescript
{
  triggers: [{ event: "app/user.created" }];
} // Single event
{
  triggers: [{ event: "app/order.completed" }];
} // Any custom event name
```

### Multiple Triggers

```typescript
{
  triggers: [{ event: "app/user.created" }, { event: "app/user.imported" }];
}
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
import { inngest } from "../../src/sidecar/client.ts";

export default inngest.createFunction(
  {
    id: "daily-cleanup",
    name: "Daily Cleanup",
    triggers: [{ cron: "TZ=America/Detroit 0 3 * * *" }],
  },
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
import { inngest } from "../../src/sidecar/client.ts";

export default inngest.createFunction(
  { id: "handle-webhook", name: "Handle Webhook", triggers: [{ event: "app/webhook.received" }] },
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
import { inngest } from "../../src/sidecar/client.ts";

export default inngest.createFunction(
  { id: "onboarding-flow", name: "Onboarding Flow", triggers: [{ event: "app/user.signed-up" }] },
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
import { inngest } from "../../src/sidecar/client.ts";

export default inngest.createFunction(
  { id: "monitor-something", name: "Monitor Something", triggers: [{ cron: "*/15 * * * *" }] },
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

## Best Practices

### Use the Logger

Every sidecar function receives a `logger` via the function context. **Use it.** When something goes wrong, logs are the only way to debug sidecar functions. The logger is a [pino](https://github.com/pinojs/pino) instance configured in `src/lib/logger.ts`.

```typescript
export default inngest.createFunction(
  { id: "my-function", triggers: [{ cron: "0 9 * * *" }] },
  async ({ step, logger }) => {
    const result = await step.run("do-work", async () => {
      logger.info("Starting work...");
      // ...
      logger.info({ resultCount: items.length }, "Work completed");
      return items;
    });
  },
);
```

Log structured data as the first argument and a message as the second — pino style:

```typescript
logger.info({ exitCode: 0, outputLen: 512 }, "script-finished");
logger.warn({ err }, "Failed to parse JSON — using fallback");
```

### Shell Scripts — Use `spawnSync`, Not `execSync`

When running shell scripts, **always use `spawnSync`** from `child_process`. It captures stdout and stderr separately, gives you the exit code, and doesn't throw on non-zero exit.

`execSync` only captures stdout — if the script writes to stderr (common for formatted output, progress, errors), that output goes straight to the sidecar error log and you'll never see it.

```typescript
const { spawnSync } = await import("child_process");
const proc = spawnSync("./workspace-utah/scripts/my-script.sh", ["--flag"], {
  encoding: "utf-8",
  timeout: 120_000,
  cwd: process.cwd(),
  env: { ...process.env, PATH: FULL_PATH },
});

logger.info(
  { exitCode: proc.status, stdoutLen: proc.stdout?.length, stderrLen: proc.stderr?.length },
  "script-result",
);

if (proc.status !== 0) {
  throw new Error(`Script failed (exit ${proc.status}): ${proc.stderr}`);
}
```

### PATH for External CLIs

The sidecar runs via launchd, which has a **minimal PATH** — your shell profile (`~/.zshrc`, etc.) is not sourced. If your function calls external CLIs (like `gws`, `gh`, etc.), you must explicitly add their directories to PATH:

```typescript
const AGENT_BIN = `${process.env.HOME}/.pi/agent/bin`;
const FULL_PATH = [AGENT_BIN, process.env.PATH].join(":");

// Then pass it to spawnSync:
const proc = spawnSync(script, args, {
  env: { ...process.env, PATH: FULL_PATH },
  // ...
});
```

Without this, the script will silently fail to find the CLI — especially dangerous if errors are swallowed with `|| true` in shell scripts.

### No `enum` or `namespace`

TypeScript `enum` and `namespace` are not supported because the sidecar uses `--experimental-strip-types`. Use `as const` objects or union types instead.
