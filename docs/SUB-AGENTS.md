# Sub-Agent Spawning for Utah

*Design doc — 2026-02-22*

## Problem

Long conversations with tool-heavy coding work blow up context windows. Utah's current mitigations (two-tier pruning, compaction) help but are lossy — they throw away context that might matter. A coding task with 15+ tool calls fills the window, then compaction summarizes away details the agent might need for the next task.

The real fix: **delegate complex work to an isolated sub-agent that runs in its own context window and reports back a summary.**

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

## 2. Mapping to Inngest Primitives

### Option A: `step.invoke()` — Child Function (Recommended)

```typescript
// Parent function
const result = await step.invoke("sub-agent-coding-task", {
  function: subAgentHandler,  // a separate Inngest function
  data: {
    task: "Refactor the auth module to use JWT tokens",
    contextFiles: ["src/auth/index.ts", "src/auth/types.ts"],
    parentSessionKey: "main",
    subSessionKey: `sub-${crypto.randomUUID()}`,
  },
});
// result.response is the summary — that's all the parent sees
```

```typescript
// Sub-agent function
export const subAgentHandler = inngest.createFunction(
  {
    id: "agent-sub-agent",
    retries: 1,
  },
  { event: "agent.subagent.spawn" },
  async ({ event, step }) => {
    const { task, contextFiles, subSessionKey } = event.data;

    // Build a focused system prompt with sub-agent framing
    const systemPrompt = await step.run("load-context", () =>
      buildSubAgentSystemPrompt(task, contextFiles)
    );

    // Run the same agent loop but with isolated session
    const agentLoop = createAgentLoop(task, subSessionKey);
    const result = await agentLoop(step);

    // Clean up session file (optional — could archive instead)
    await step.run("cleanup", () => cleanupSession(subSessionKey));

    return result; // { response, iterations, toolCalls, model }
  },
);
```

**Why `step.invoke()`:**
- Returns the child function's output directly — natural for "spawn and wait"
- Child function has its own step history, retries, and observability
- Parent's step history stays lean — one `step.invoke` entry vs N tool steps
- Inngest dashboard shows the parent→child relationship
- Child can be cancelled independently

### Option B: `step.sendEvent()` + polling (async/fire-and-forget)

For cases where the parent shouldn't block:

```typescript
await step.sendEvent("spawn-sub-agent", {
  name: "agent.subagent.spawn",
  data: { task, parentSessionKey, subSessionKey, replyEvent: "agent.subagent.done" },
});

// Parent continues or waits for a callback event
const result = await step.waitForEvent("sub-agent-result", {
  event: "agent.subagent.done",
  match: "data.subSessionKey",
  timeout: "10m",
});
```

This is more complex but enables parallel sub-agents.

### Recommendation

**Use `step.invoke()` for v1.** It's simpler, the parent naturally waits, and the result flows back directly. Move to event-based if you need parallelism later.

---

## 3. Sub-Agent Session Lifecycle

```
Parent Session                          Sub-Agent Session
─────────────                           ─────────────────
1. User asks complex task
2. Agent decides to spawn          ──→  3. New function invocation
   (heuristic or explicit)              4. Fresh context window
                                        5. System prompt with:
                                           - Sub-agent framing
                                           - Task description
                                           - Relevant file paths
                                           - "You are a sub-agent..."
                                        6. Agent loop runs
                                           - Reads files ─── (shared filesystem)
                                           - Edits code  ─── (shared filesystem)
                                           - Runs commands
                                        7. Final text response = summary
3. Receives summary only           ←──  8. Return result
4. Continues conversation
   with just the summary
   in context
```

**Session isolation:**
- Sub-agent gets a unique session key (`sub-{uuid}`)
- Its JSONL history is separate from the parent
- It loads the same workspace files (SOUL.md, USER.md, MEMORY.md) for identity
- It does NOT load the parent's conversation history

**Cleanup options:**
- Delete the sub-session JSONL after completion (saves disk)
- Archive it (move to `sessions/archive/`) for debugging
- Keep it with a TTL (auto-delete after 24h)

---

## 4. Keeping the Parent Session Lean

The whole point: parent context only grows by the **summary size**, not the tool call history.

**Without sub-agents (current):**
```
User message                    ~200 tokens
Assistant (15 tool calls)     ~3000 tokens (tool call blocks)
Tool results (15)             ~8000 tokens (file contents, command output)
Assistant final response        ~500 tokens
─────────────────────────────
Total added to context:       ~11,700 tokens
```

**With sub-agents:**
```
User message                    ~200 tokens
Assistant "spawning sub-agent"   ~50 tokens
Sub-agent summary               ~300 tokens
Assistant final response        ~200 tokens
─────────────────────────────
Total added to context:          ~750 tokens  (94% reduction)
```

**Implementation in the parent:**

```typescript
// After step.invoke returns:
await appendToSession(sessionKey, "assistant", 
  `I delegated this to a sub-agent. Here's what was done:\n\n${result.response}`
);
```

The sub-agent's 15 tool calls, file reads, and command outputs never enter the parent's message history.

---

## 5. When to Spawn vs Handle Inline

### Heuristics

| Signal | Inline | Spawn Sub-Agent |
|--------|--------|-----------------|
| Expected tool calls | 0–3 | 4+ |
| Task complexity | Simple lookup/edit | Multi-file refactor, research |
| Current context usage | < 60% window | > 60% window |
| Task independence | Needs conversation context | Self-contained with a clear goal |
| User expectation | Quick answer | "Do this work for me" |

### Implementation: Token Budget Check

```typescript
const SPAWN_THRESHOLDS = {
  // Spawn if context is already this full
  contextPressure: 0.6,
  // Spawn if task likely needs this many tool calls
  expectedToolCalls: 4,
  // Keywords that suggest complex work
  complexitySignals: [
    /refactor/i, /implement/i, /create.*(?:file|module|component)/i,
    /fix.*(?:bug|error|issue)/i, /research.*(?:and|then)/i,
    /write.*(?:test|doc|design)/i, /migrate/i, /update.*(?:all|every)/i,
  ],
};

function shouldSpawnSubAgent(
  task: string,
  currentTokens: number,
  maxTokens: number,
): boolean {
  // Context pressure
  if (currentTokens / maxTokens > SPAWN_THRESHOLDS.contextPressure) return true;
  
  // Complexity signals
  const complexityScore = SPAWN_THRESHOLDS.complexitySignals
    .filter(r => r.test(task)).length;
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
    contextFiles: Type.Optional(Type.Array(Type.String(), { 
      description: "File paths the sub-agent should read first for context" 
    })),
  }),
};
```

**Recommendation:** Start with the tool approach. The LLM already has good intuition about task complexity, and it avoids brittle heuristics. Add the heuristic check as a fallback/override.

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
- **System prompt details** — sub-agent gets a focused prompt

### Sub-Agent Context Injection

The sub-agent's system prompt should include:

```markdown
## Sub-Agent Context

You are a sub-agent spawned by the parent session for a specific task.

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
```

### Workspace Files as Shared Memory

For more structured handoff, sub-agents can write to a shared location:

```typescript
// Sub-agent writes structured output
await write("workspace/.sub-agent-results/task-abc.md", resultMarkdown);

// Parent reads it if needed (beyond the summary)
const details = await read("workspace/.sub-agent-results/task-abc.md");
```

This is useful when the parent might need to reference detailed output later without re-running the sub-agent.

---

## Implementation Plan

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

```typescript
const MAX_SUB_AGENT_DEPTH = 2;

// In sub-agent system prompt or tool filtering:
if (depth >= MAX_SUB_AGENT_DEPTH) {
  // Don't give sub-agent the spawn_sub_agent tool
}
```

---

## Comparison with Existing Approaches

| Aspect | Utah (current) | OpenClaw/Pi | Pi-mono | This Proposal |
|--------|---------------|-------------|---------|---------------|
| Context management | Pruning + compaction | Pruning + compaction + sub-agents | Session branching | Pruning + compaction + sub-agents |
| Sub-agent spawning | ❌ | `sessions_spawn` | ❌ (branching only) | `step.invoke()` tool |
| Isolation | N/A | Separate session | Branch shares history | Separate Inngest function |
| Result passing | N/A | Announce-back (final message) | Branch continues | `step.invoke()` return value |
| Durability | Inngest steps | In-process | In-process | Inngest steps (both parent + child) |
| Observability | Inngest dashboard | Logs | Logs | Inngest dashboard (parent→child) |

The key advantage of Utah's approach: **Inngest gives you durability and observability for free** on both the parent and sub-agent. If a sub-agent crashes mid-way, Inngest retries it. The parent's `step.invoke()` is checkpointed — it won't re-spawn on retry.
