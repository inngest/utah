/**
 * Sub-Agent — an isolated agent loop invoked by the parent via step.invoke().
 *
 * Runs in its own context window with a fresh conversation history.
 * The parent only sees the final summary response.
 *
 * The sub-agent does NOT have the delegate_task tool to prevent recursive spawning.
 */

import { inngest, agentSubagentSpawn } from "../client.ts";
import { createAgentLoop } from "../agent-loop.ts";
import { SUB_AGENT_TOOLS } from "../lib/tools.ts";

export const subAgent = inngest.createFunction(
  {
    id: "agent-sub-agent",
    retries: 1,
    triggers: [agentSubagentSpawn],
  },
  async ({ event, step }) => {
    const { task, subSessionKey } = event.data;

    // Prepend sub-agent framing to the task
    const framedTask = `## Sub-Agent Context

You are a sub-agent spawned by the parent session for a specific task.
Complete the task below. Your final text response will be returned to the parent as a summary.
Be concise but informative — include what you changed, files modified, and any issues.

## Your Task
${task}`;

    // Run the agent loop with isolated session and restricted tools (no delegate_task)
    const agentLoop = createAgentLoop(framedTask, subSessionKey, {
      tools: SUB_AGENT_TOOLS,
      isSubAgent: true,
    });
    const result = await agentLoop(step);

    return result;
  },
);
