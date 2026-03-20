/**
 * Delegation eval — measures whether the LLM correctly delegates tasks
 * to sub-agents vs handling them inline.
 *
 * Run: pnpm run eval
 */

import { buildSystemPrompt } from "../src/lib/context.ts";
import { callLLM } from "../src/lib/llm.ts";
import { TOOLS } from "../src/lib/tools.ts";

type ExpectedAction = "delegate_task" | "delegate_async_task" | "delegate_scheduled_task" | "none";

interface TestCase {
  input: string;
  expect: ExpectedAction;
}

const testCases: TestCase[] = [
  // SHOULD delegate_task (sync)
  {
    input: "Refactor all channel handlers to use a shared base class",
    expect: "delegate_task",
  },
  {
    input: "Read through src/lib/ and summarize what each file does",
    expect: "delegate_task",
  },
  {
    input: "Add error handling to all the API route files",
    expect: "delegate_task",
  },
  {
    input: "Rename the 'remember' tool to 'save_note' everywhere it's referenced",
    expect: "delegate_task",
  },

  // SHOULD delegate_async_task
  {
    input: "Go research how pi-ai handles streaming and write up your findings",
    expect: "delegate_async_task",
  },

  // SHOULD delegate_scheduled_task
  {
    input: "Remind me tomorrow at 9am to review the PR",
    expect: "delegate_scheduled_task",
  },
  {
    input: "Check the deploy status at 5pm today and let me know",
    expect: "delegate_scheduled_task",
  },

  // SHOULD NOT delegate
  {
    input: "What's in src/config.ts?",
    expect: "none",
  },
  {
    input: "How does the agent loop work?",
    expect: "none",
  },
  {
    input: "What time is it?",
    expect: "none",
  },
  {
    input: "Hey, good morning",
    expect: "none",
  },
];

const DELEGATION_TOOLS = new Set([
  "delegate_task",
  "delegate_async_task",
  "delegate_scheduled_task",
]);

async function runEval() {
  const systemPrompt = await buildSystemPrompt();
  let passed = 0;
  let failed = 0;

  console.log(`System prompt length: ${systemPrompt.length} chars`);
  console.log(`Tools: ${TOOLS.map((t) => t.name).join(", ")}`);
  console.log(`Running ${testCases.length} delegation eval cases...\n`);

  for (const tc of testCases) {
    const messages = [{ role: "user" as const, content: tc.input, timestamp: Date.now() }];

    try {
      const response = await callLLM(systemPrompt, messages, TOOLS);

      // Log model on first call
      if (passed + failed === 0) {
        console.log(`Model: ${response.model}\n`);
      }

      // Fail fast on API errors — don't silently count them as "no delegation"
      if (response.stopReason === "error") {
        const msg = response.message.errorMessage || "unknown error";
        console.error(`\n  ✗ API ERROR on first call — aborting eval.\n    ${msg}\n`);
        process.exit(2);
      }

      // Check the first tool call (if any)
      const firstDelegationCall = response.toolCalls.find((c) => DELEGATION_TOOLS.has(c.name));
      const actual: ExpectedAction = firstDelegationCall
        ? (firstDelegationCall.name as ExpectedAction)
        : "none";

      const allToolNames = response.toolCalls.map((c) => c.name);
      const textPreview = response.text.slice(0, 120).replace(/\n/g, " ");

      const pass = actual === tc.expect;
      if (pass) {
        passed++;
        console.log(`  ✓ PASS: "${tc.input}"`);
        console.log(`          expected=${tc.expect} actual=${actual}`);
      } else {
        failed++;
        console.log(`  ✗ FAIL: "${tc.input}"`);
        console.log(`          expected=${tc.expect} actual=${actual}`);
      }
      if (allToolNames.length > 0) {
        console.log(`          tools=[${allToolNames.join(", ")}]`);
      }
      if (textPreview) {
        console.log(`          text="${textPreview}${response.text.length > 120 ? "…" : ""}"`);
      }
    } catch (err) {
      failed++;
      console.log(`  ✗ ERROR: "${tc.input}"`);
      console.log(`           ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log();
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed}/${testCases.length} passed, ${failed} failed`);
  console.log(`Score: ${((passed / testCases.length) * 100).toFixed(0)}%`);
  console.log(`${"=".repeat(50)}`);

  process.exit(failed > 0 ? 1 : 0);
}

runEval();
