/**
 * Sub-Agent — an isolated agent loop that can run sync or async.
 *
 * Sync mode: invoked by parent via step.invoke(), returns result to parent.
 * Async mode: triggered by event, runs independently, replies directly to user.
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
  async ({ event, step, logger }) => {
    const { task, subSessionKey, async: isAsync, scheduledFor, channel, destination, channelMeta } = event.data;

    // Prepend sub-agent framing to the task
    const scheduledContext = scheduledFor
      ? `\nThis task was scheduled earlier and is now running at the scheduled time (${scheduledFor}).
The user may not remember the exact context — include enough background in your response.\n`
      : "";

    const framedTask = isAsync
      ? `## Sub-Agent Context

You are an async sub-agent spawned to handle a task independently.${scheduledContext}
Complete the task below. Your final text response will be sent directly to the user.
Be thorough and clear — this is your only chance to communicate the results.

## Your Task
${task}`
      : `## Sub-Agent Context

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
    const result = await agentLoop(step, logger);

    // Async mode: reply directly to the user via the channel
    if (isAsync && channel && destination) {
      await step.sendEvent("async-reply", {
        name: "agent.reply.ready",
        data: {
          response: result.response,
          channel,
          destination,
          channelMeta: channelMeta || {},
        },
      });
    }

    return result;
  },
);
