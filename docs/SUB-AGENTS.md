# Sub-Agent Spawning for Utah

<<<<<<< Updated upstream
_Design doc — 2026-02-22 / Updated 2026-03-06_
=======
_Design doc — 2026-02-22_

> > > > > > > Stashed changes

## Problem

Long conversations with tool-heavy coding work blow up context windows. Utah's mitigations (two-tier pruning, compaction) help but are lossy — they throw away context that might matter. A coding task with 15+ tool calls fills the window, then compaction summarizes away details the agent might need for the next task.

The real fix: **delegate complex work to an isolated sub-agent that runs in its own context window and reports back a summary** — or, for longer-running work, **let the sub-agent reply directly to the user** without blocking the parent.

---

## 1. How OpenClaw Handles Sub-Agent Spawning

OpenClaw/Pi uses a `sessions_spawn` mechanism:

- **Parent session** calls `sessions_spawn` with a task description and optional context
- A **new isolated session** is created with its own conversation history, system prompt, and context window
- The sub-agent runs its full tool loop independently (reads files, edits code, runs commands)
- When done, the sub-agent's final text response is the **result** — a summary of what it did
- The parent session receives only that summary (the "announce-back" pattern)
- The sub-agent session can be cleaned up or archived

**Key properties:**

- Sub-agent gets a **fresh context window** — no inherited conversation bloat
- Parent never sees the sub-agent's tool call history — only the final summary
- Sub-agent inherits the **workspace** (filesystem) but not the conversation
- A **subagent context injection** tells the sub-agent its role, task, and constraints

This is exactly what we see in the system prompt of this very session — look at the "Subagent Context" section above. The parent spawned us with a task, we work independently, and our final message goes back.

---

## 2. Two Delegation Modes: Sync and Async

Utah implements both synchronous and asynchronous sub-agent spawning. The mental model:

<<<<<<< Updated upstream

- **Sync sub-agents are tools.** The parent uses the result. Like calling a function — you wait for the return value.
- **Async sub-agents are colleagues.** They own the reply end-to-end. Like handing off a task — you tell the user it's being handled and move on.

Both modes run the same `agent-sub-agent` Inngest function. The difference is in how they're triggered and how results flow back.

### Sync Path: `delegate_task` → `step.invoke()`

The parent calls `step.invoke()`, which blocks until the sub-agent finishes. The sub-agent's result flows back as a tool result in the parent's conversation.

````
Parent Loop                             Sub-Agent Function
───────────                             ──────────────────
LLM calls delegate_task
  ↓
step.invoke("sub-agent", {       ──→    agent-sub-agent triggered
  function: subAgent,                   createAgentLoop(task, subSessionKey, {
  data: { task, subSessionKey,            tools: SUB_AGENT_TOOLS,
    parentSessionKey }                    isSubAgent: true
})                                      })
  │                                     Agent loop runs...
  │ (blocked)                           Reads files, edits code, etc.
  │                                     Returns { response, iterations, ... }
  ↓                              ←──
Tool result = response
LLM continues with summary
=======
```typescript
// Parent function
const result = await step.invoke("sub-agent-coding-task", {
  function: subAgentHandler, // a separate Inngest function
  data: {
    task: "Refactor the auth module to use JWT tokens",
    contextFiles: ["src/auth/index.ts", "src/auth/types.ts"],
    parentSessionKey: "main",
    subSessionKey: `sub-${crypto.randomUUID()}`,
  },
});
// result.response is the summary — that's all the parent sees
>>>>>>> Stashed changes
````

In `agent-loop.ts`, the sync delegation path:

```typescript
if (tc.name === "delegate_task" && !options?.isSubAgent) {
  const subSessionKey = `sub-${sessionKey}-${Date.now()}`;
  const { subAgent } = await import("./functions/sub-agent.ts");
  const subResult = await step.invoke("sub-agent", {
    function: subAgent,
    data: {
      task: tc.arguments.task as string,
      subSessionKey,
      parentSessionKey: sessionKey,
    },
  });
  toolResult = {
    result: subResult?.response || "(Sub-agent returned no response)",
  };
}
```

The LLM receives the summary as a regular tool result and can synthesize, comment on, or build on it.

### Async Path: `delegate_async_task` → `step.sendEvent()`

The parent fires an event and moves on immediately. The sub-agent runs independently and, when finished, emits `agent.reply.ready` to send its response directly to the user through the originating channel.

```
Parent Loop                             Sub-Agent Function
───────────                             ──────────────────
LLM calls delegate_async_task
  ↓
step.sendEvent({                 ──→    agent-sub-agent triggered
  name: "agent.subagent.spawn",           (same function, async: true)
  data: { task, subSessionKey,          createAgentLoop(task, ...)
    async: true,                        Agent loop runs independently...
    channel, destination,
    channelMeta }
})
  ↓ (immediate)                           │
Tool result = "Async sub-agent            │
  has been spawned..."                    │
LLM continues — tells user               │
  the task is being handled               ↓
                                        step.sendEvent("async-reply", {
                                          name: "agent.reply.ready",
                                          data: { response, channel,
                                            destination, channelMeta }
                                        })
                                          ↓
                                        Reply delivered to user
                                        via originating channel
```

In `agent-loop.ts`, the async delegation path:

```typescript
if (tc.name === "delegate_async_task" && !options?.isSubAgent) {
  const subSessionKey = `sub-${sessionKey}-${Date.now()}`;
  await step.sendEvent("spawn-async-sub-agent", {
    name: "agent.subagent.spawn",
    data: {
      task: tc.arguments.task as string,
      subSessionKey,
      parentSessionKey: sessionKey,
      async: true,
      ...(loopChannel
        ? {
            channel: loopChannel.channel,
            destination: loopChannel.destination,
            channelMeta: loopChannel.channelMeta,
          }
        : {}),
    },
  });
  toolResult = {
    result:
      "Async sub-agent has been spawned. It will reply directly to the user when complete. Continue your conversation — do NOT wait for a result.",
  };
}
```

The tool result tells the LLM the sub-agent is running. The LLM then decides what to tell the user — it's not hard-coded. This is a deliberate design choice: the LLM might say "I've kicked that off, it'll take a minute" or "Working on that in the background — anything else?" depending on conversational context. It feels agentic rather than mechanical.

### Channel Routing

For async sub-agents to reply to the user, they need to know _where_ the user is. The parent passes channel routing info through the spawn event:

```typescript
// AgentLoopOptions includes channelRouting
channelRouting?: {
  channel: string;           // e.g. "telegram"
  destination: {
    chatId: string;          // where to send the reply
    messageId?: string;
    threadId?: string;
  };
  channelMeta: Record<string, unknown>;  // channel-specific data
};
```

This routing info flows: **parent loop → spawn event → sub-agent → `agent.reply.ready` event → channel handler**. The sub-agent doesn't need to know anything about Telegram or Slack — it just passes the routing forward.

### The Sub-Agent Function: One Function, Two Modes

`src/functions/sub-agent.ts` handles both modes with a single Inngest function:

```typescript
export const subAgent = inngest.createFunction(
  { id: "agent-sub-agent", retries: 1, triggers: [agentSubagentSpawn] },
  async ({ event, step }) => {
    const { task, subSessionKey, async: isAsync, channel, destination, channelMeta } = event.data;

    // Different framing for sync vs async
    const framedTask = isAsync
      ? `## Sub-Agent Context\n\nYou are an async sub-agent...your response will be sent directly to the user.\n\n## Your Task\n${task}`
      : `## Sub-Agent Context\n\nYou are a sub-agent...your response will be returned to the parent as a summary.\n\n## Your Task\n${task}`;

    const agentLoop = createAgentLoop(framedTask, subSessionKey, {
      tools: SUB_AGENT_TOOLS,
      isSubAgent: true,
    });
    const result = await agentLoop(step);

    // Async: emit reply event so the channel handler delivers it
    if (isAsync && channel && destination) {
      await step.sendEvent("async-reply", {
        name: "agent.reply.ready",
        data: { response: result.response, channel, destination, channelMeta: channelMeta || {} },
      });
    }

<<<<<<< Updated upstream
    return result;  // Sync: parent reads this via step.invoke()
  },
);
```

Key details:

- **System prompt framing differs**: sync sub-agents are told to be concise (parent will synthesize), async sub-agents are told to be thorough (they're the final word).
- **`SUB_AGENT_TOOLS`** excludes `delegate_task` and `delegate_async_task` — no recursive spawning.
- # **`isSubAgent: true`** in the loop options ensures that even if the tool names somehow appear, the delegation code paths are skipped.
      return result; // { response, iterations, toolCalls, model }
  }
  );

````

**Why `step.invoke()`:**

- Returns the child function's output directly — natural for "spawn and wait"
- Child function has its own step history, retries, and observability
- Parent's step history stays lean — one `step.invoke` entry vs N tool steps
- Inngest dashboard shows the parent→child relationship
- Child can be cancelled independently
>>>>>>> Stashed changes

### Event Schema

The spawn event carries everything both modes need:

```typescript
export const agentSubagentSpawn = eventType("agent.subagent.spawn", {
  schema: staticSchema<{
    task: string;
    subSessionKey: string;
    parentSessionKey: string;
    async?: boolean;              // false/undefined = sync, true = async
    channel?: string;             // only needed for async
    destination?: {               // only needed for async
      chatId: string;
      messageId?: string;
      threadId?: string;
    };
    channelMeta?: Record<string, unknown>;  // only needed for async
  }>(),
});
````

---

## 3. Sub-Agent Session Lifecycle

```
Parent Session                          Sub-Agent Session
─────────────                           ─────────────────

SYNC PATH:
1. User asks complex task
2. LLM calls delegate_task         ──→  3. step.invoke() triggers function
                                        4. Fresh context window
                                        5. System prompt with:
                                           - Sub-agent framing (sync)
                                           - Task description
                                           - "Be concise — parent reads this"
                                        6. Agent loop runs
                                           - Reads files ─── (shared filesystem)
                                           - Edits code  ─── (shared filesystem)
                                           - Runs commands
                                        7. Final text response = summary
3. Receives summary as tool result ←──  8. Return result
4. LLM continues conversation
   with just the summary in context

ASYNC PATH:
1. User asks complex task
2. LLM calls delegate_async_task   ──→  3. sendEvent() triggers function
3. LLM tells user "working on it"       4. Fresh context window
4. Parent conversation continues         5. System prompt with:
   (or ends)                                - Sub-agent framing (async)
                                            - Task description
                                            - "Be thorough — user sees this"
                                         6. Agent loop runs independently
                                         7. Final text response
                                         8. Emits agent.reply.ready ──→ User
```

**Session isolation:**
<<<<<<< Updated upstream

- # Sub-agent gets a unique session key (`sub-{parentKey}-{timestamp}`)

- Sub-agent gets a unique session key (`sub-{uuid}`)
  > > > > > > > Stashed changes
- Its JSONL history is separate from the parent
- It loads the same workspace files (SOUL.md, USER.md, MEMORY.md) for identity
- It does NOT load the parent's conversation history

# <<<<<<< Updated upstream

**Cleanup options:**

- Delete the sub-session JSONL after completion (saves disk)
- Archive it (move to `sessions/archive/`) for debugging
- Keep it with a TTL (auto-delete after 24h)

> > > > > > > Stashed changes

---

## 4. Keeping the Parent Session Lean

The whole point: parent context only grows by the **summary size** (sync) or **a single acknowledgment** (async), not the tool call history.

**Without sub-agents (current):**

```
User message                    ~200 tokens
Assistant (15 tool calls)     ~3000 tokens (tool call blocks)
Tool results (15)             ~8000 tokens (file contents, command output)
Assistant final response        ~500 tokens
─────────────────────────────
Total added to context:       ~11,700 tokens
```

<<<<<<< Updated upstream
**With sync sub-agent:**
=======
**With sub-agents:**

> > > > > > > Stashed changes

```
User message                    ~200 tokens
Assistant delegate_task call     ~50 tokens
Sub-agent summary (tool result) ~300 tokens
Assistant final response        ~200 tokens
─────────────────────────────
Total added to context:          ~750 tokens  (94% reduction)
```

<<<<<<< Updated upstream
**With async sub-agent:**

````
User message                    ~200 tokens
Assistant delegate_async_task    ~50 tokens
Tool result ("spawned...")       ~30 tokens
Assistant "working on it"       ~100 tokens
─────────────────────────────
Total added to context:          ~380 tokens  (97% reduction)
=======
**Implementation in the parent:**

```typescript
// After step.invoke returns:
await appendToSession(
  sessionKey,
  "assistant",
  `I delegated this to a sub-agent. Here's what was done:\n\n${result.response}`
);
>>>>>>> Stashed changes
````

The sub-agent's 15 tool calls, file reads, and command outputs never enter the parent's message history.

---

## 5. When to Spawn vs Handle Inline

The LLM decides. Both `delegate_task` and `delegate_async_task` are exposed as tools with clear descriptions of when to use each:

<<<<<<< Updated upstream
| Signal | Inline | `delegate_task` (sync) | `delegate_async_task` (async) |
|--------|--------|------------------------|-------------------------------|
| Expected tool calls | 0–3 | 4+ | 4+ |
| Task complexity | Simple lookup/edit | Multi-file refactor, research | Long-running work |
| Parent needs result? | Yes | Yes — uses it to respond | No — sub-agent replies directly |
| User expectation | Quick answer | "Do this and tell me about it" | "Do this in the background" |
| Blocks parent? | N/A | Yes | No |
=======
| Signal | Inline | Spawn Sub-Agent |
| --------------------- | -------------------------- | -------------------------------- |
| Expected tool calls | 0–3 | 4+ |
| Task complexity | Simple lookup/edit | Multi-file refactor, research |
| Current context usage | < 60% window | > 60% window |
| Task independence | Needs conversation context | Self-contained with a clear goal |
| User expectation | Quick answer | "Do this work for me" |

> > > > > > > Stashed changes

The tool descriptions guide the LLM's choice:

<<<<<<< Updated upstream

- **`delegate_task`**: "You'll receive a summary of what it accomplished."
- # **`delegate_async_task`**: "You will NOT receive the result — respond to the user acknowledging you've kicked it off."

```typescript
const SPAWN_THRESHOLDS = {
  // Spawn if context is already this full
  contextPressure: 0.6,
  // Spawn if task likely needs this many tool calls
  expectedToolCalls: 4,
  // Keywords that suggest complex work
  complexitySignals: [
    /refactor/i,
    /implement/i,
    /create.*(?:file|module|component)/i,
    /fix.*(?:bug|error|issue)/i,
    /research.*(?:and|then)/i,
    /write.*(?:test|doc|design)/i,
    /migrate/i,
    /update.*(?:all|every)/i,
  ],
};

function shouldSpawnSubAgent(task: string, currentTokens: number, maxTokens: number): boolean {
  // Context pressure
  if (currentTokens / maxTokens > SPAWN_THRESHOLDS.contextPressure) return true;

  // Complexity signals
  const complexityScore = SPAWN_THRESHOLDS.complexitySignals.filter((r) => r.test(task)).length;
  if (complexityScore >= 2) return true;

  return false;
}
```

### As a Tool (Let the LLM Decide)

Alternatively, expose spawning as a tool and let the LLM decide:

```typescript
const spawnSubAgentTool: Tool = {
  name: "spawn_sub_agent",
  description: `Delegate a self-contained task to a sub-agent that runs in an isolated context. 
Use this when:
- The task requires many file reads/edits (4+ tool calls expected)
- You're running low on iteration budget
- The task is independent and can be described as a clear goal
The sub-agent has access to the same workspace but its own conversation context.
You'll receive a summary of what it did.`,
  parameters: Type.Object({
    task: Type.String({ description: "Clear description of what the sub-agent should do" }),
    contextFiles: Type.Optional(
      Type.Array(Type.String(), {
        description: "File paths the sub-agent should read first for context",
      }),
    ),
  }),
};
```

**Recommendation:** Start with the tool approach. The LLM already has good intuition about task complexity, and it avoids brittle heuristics. Add the heuristic check as a fallback/override.

> > > > > > > Stashed changes

---

## 6. Memory & Workspace: Bridging Context

Sub-agents and parents share context through **the filesystem**, not conversation history.

### Shared (via workspace)

- **Files on disk** — sub-agent reads/writes the same codebase
- **MEMORY.md** — long-term memory available to both
- **Daily logs** (`memory/YYYY-MM-DD.md`) — sub-agent can use `remember` tool
- **SOUL.md / USER.md** — identity and user preferences

### Not Shared

- **Conversation history** — each has its own JSONL session
- **Tool call results** — sub-agent's tool outputs stay in its session
- **System prompt framing** — sub-agent gets a focused prompt for its task

### Sub-Agent Context Injection

The sub-agent's task is framed with role-appropriate context at the top of the message:

**Sync framing** (result goes to parent):

```markdown
## Sub-Agent Context

You are a sub-agent spawned by the parent session for a specific task.
Complete the task below. Your final text response will be returned to the parent as a summary.
Be concise but informative — include what you changed, files modified, and any issues.

<<<<<<< Updated upstream

## Your Task

# {task description from parent}

### Your Task

{task description from parent}

### Key Files

{list of contextFiles if provided}

### Rules

1. Complete the assigned task — that's your entire purpose
2. Your final text response will be returned to the parent as a summary
3. Be concise but informative in your summary — include what you changed and why
4. Write important decisions/context to memory if they should persist
5. You have full access to the workspace (read, edit, write, bash)

### Output Format

When done, your response should include:

- What you accomplished
- Files changed (with brief descriptions)
- Any issues or decisions the parent should know about
  > > > > > > > Stashed changes
```

**Async framing** (result goes to user):

```markdown
## Sub-Agent Context

You are an async sub-agent spawned to handle a task independently.
Complete the task below. Your final text response will be sent directly to the user.
Be thorough and clear — this is your only chance to communicate the results.

## Your Task

{task description from parent}
```

---

## 7. Failure Handling

<<<<<<< Updated upstream
The global failure handler (`src/functions/failure-handler.ts`) covers both paths.

For **sync failures**, Inngest's retry mechanism handles it naturally — `step.invoke()` will retry the sub-agent function, and if it exhausts retries, the parent receives the error.

# For **async failures**, the failure handler catches the `inngest/function.failed` event and checks for channel routing info on the original spawn event:

### Phase 1: Core Infrastructure

1. Create `src/functions/sub-agent.ts` — the sub-agent Inngest function
2. Create `src/lib/sub-agent.ts` — helper to build sub-agent system prompts
3. Add `spawn_sub_agent` tool to `src/lib/tools.ts`
4. Wire tool execution to `step.invoke()` in the agent loop

### Phase 2: Context Management

5. Add `buildSubAgentSystemPrompt()` to `src/lib/context.ts`
6. Add sub-session cleanup to `src/lib/session.ts`
7. Add token estimation to spawn heuristics

### Phase 3: Refinement

8. Add parallel sub-agent support (event-based)
9. Add sub-agent depth limits (no infinite spawning)
10. Add observability (log parent→child relationships)

### Key Constraint: Depth Limit

Prevent runaway spawning:

> > > > > > > Stashed changes

```typescript
const channel = data.event?.data?.channel;
const handler = channel ? getChannel(channel) : undefined;

if (handler) {
  const destination = data.event?.data?.destination as Destination;
  await handler.sendReply({
    response: `**Something went wrong.**\n\n**Error:** ${errorMessage}...`,
    destination,
    channelMeta,
  });
}
```

This works because the async spawn event carries `channel`, `destination`, and `channelMeta` — the same routing info the sub-agent would have used for `agent.reply.ready`. If the sub-agent crashes, the failure handler has enough info to notify the user through the same channel.

---

## Implementation Status

<<<<<<< Updated upstream

### Done ✅

1. **`src/functions/sub-agent.ts`** — single Inngest function handling both sync and async modes
2. **`src/lib/tools.ts`** — `delegate_task` (sync) and `delegate_async_task` (async) tools exposed to the main agent; `SUB_AGENT_TOOLS` excludes both to prevent recursive spawning
3. **`src/agent-loop.ts`** — dual delegation paths: `step.invoke()` for sync, `step.sendEvent()` for async; `channelRouting` passed through `AgentLoopOptions`
4. **`src/client.ts`** — `agent.subagent.spawn` event schema with `async`, `channel`, `destination`, `channelMeta` fields
5. **`src/functions/failure-handler.ts`** — handles failures for both paths using channel routing from the spawn event
6. **Sub-agent framing** — different system prompt injections for sync vs async modes
7. # **Depth limit** — sub-agents don't get delegation tools (`isSubAgent: true` as a safety check)
   | Aspect             | Utah (current)       | OpenClaw/Pi                       | Pi-mono               | This Proposal                       |
   | ------------------ | -------------------- | --------------------------------- | --------------------- | ----------------------------------- |
   | Context management | Pruning + compaction | Pruning + compaction + sub-agents | Session branching     | Pruning + compaction + sub-agents   |
   | Sub-agent spawning | ❌                   | `sessions_spawn`                  | ❌ (branching only)   | `step.invoke()` tool                |
   | Isolation          | N/A                  | Separate session                  | Branch shares history | Separate Inngest function           |
   | Result passing     | N/A                  | Announce-back (final message)     | Branch continues      | `step.invoke()` return value        |
   | Durability         | Inngest steps        | In-process                        | In-process            | Inngest steps (both parent + child) |
   | Observability      | Inngest dashboard    | Logs                              | Logs                  | Inngest dashboard (parent→child)    |
   > > > > > > > Stashed changes

### Remaining 🔲

- **Sub-session cleanup** — archive or delete sub-agent session JSONL files after completion
- **Parallel sub-agents** — multiple async sub-agents running concurrently (works in principle, untested)
- **Observability** — structured logging of parent→child relationships beyond Inngest dashboard
- **Token estimation** — heuristic fallback for when the LLM should spawn but doesn't

---

## Comparison

| Aspect                  | Utah (before)        | OpenClaw/Pi                       | Utah (current)                                                   |
| ----------------------- | -------------------- | --------------------------------- | ---------------------------------------------------------------- |
| Context management      | Pruning + compaction | Pruning + compaction + sub-agents | Pruning + compaction + sub-agents (sync + async)                 |
| Sync spawning           | ❌                   | `sessions_spawn`                  | `delegate_task` → `step.invoke()`                                |
| Async spawning          | ❌                   | ❌                                | `delegate_async_task` → `step.sendEvent()` → `agent.reply.ready` |
| Isolation               | N/A                  | Separate session                  | Separate Inngest function + session                              |
| Result passing (sync)   | N/A                  | Announce-back (final message)     | `step.invoke()` return value → tool result                       |
| Result passing (async)  | N/A                  | N/A                               | Sub-agent emits `agent.reply.ready` → channel handler            |
| Who decides to delegate | N/A                  | Heuristic                         | LLM (tools with descriptions)                                    |
| Recursive prevention    | N/A                  | Depth limit                       | `SUB_AGENT_TOOLS` excludes delegation + `isSubAgent` flag        |
| Failure handling        | Inngest retries      | In-process                        | Inngest retries + failure handler with channel routing           |
| Durability              | Inngest steps        | In-process                        | Inngest steps (parent + child)                                   |
| Observability           | Inngest dashboard    | Logs                              | Inngest dashboard (parent→child visible)                         |

The key advantage: **Inngest gives you durability and observability for free** on both parent and sub-agent. If a sub-agent crashes mid-way, Inngest retries it. The parent's `step.invoke()` is checkpointed — it won't re-spawn on retry. And for async sub-agents, the failure handler catches crashes because channel routing travels with the spawn event.
