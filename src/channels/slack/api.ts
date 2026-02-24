/**
 * Slack Web API client.
 *
 * Shared by all Slack channel code: setup, reply, reactions.
 */

import { config } from "../../config.ts";

const SLACK_API = "https://slack.com/api";

function getBotToken(): string {
  const token = config.slack.botToken;
  if (!token) throw new Error("SLACK_BOT_TOKEN is required");
  return token;
}

/**
 * Call the Slack Web API.
 */
export async function slackAPI(
  method: string,
  params: Record<string, unknown> = {},
  options: { timeout?: number } = {},
): Promise<any> {
  const token = getBotToken();
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(options.timeout ?? 10_000),
  });
  
  const data = await res.json() as { ok: boolean; error?: string; [key: string]: any };
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`);
  return data;
}

/**
 * Send a message to a Slack channel or DM.
 */
export async function postMessage(
  channel: string,
  text: string,
  options: { 
    threadTs?: string;
    blocks?: any[];
    attachments?: any[];
  } = {},
): Promise<{ ts: string; channel: string }> {
  const body: Record<string, unknown> = {
    channel,
    text,
  };
  
  if (options.threadTs) body.thread_ts = options.threadTs;
  if (options.blocks) body.blocks = options.blocks;
  if (options.attachments) body.attachments = options.attachments;
  
  return slackAPI("chat.postMessage", body);
}

/**
 * Add a reaction to a message.
 */
export async function addReaction(
  channel: string,
  timestamp: string,
  name: string,
): Promise<void> {
  await slackAPI("reactions.add", {
    channel,
    timestamp,
    name,
  }, { timeout: 5000 }).catch(() => {});
}

/**
 * Get bot info (user ID, name, etc).
 */
export async function authTest(): Promise<{
  ok: boolean;
  user_id: string;
  user: string;
  team_id: string;
  team: string;
  bot_id?: string;
}> {
  return slackAPI("auth.test");
}

/**
 * Get user info by user ID.
 */
export async function usersInfo(userId: string): Promise<{
  user: {
    id: string;
    name: string;
    real_name?: string;
    profile: {
      display_name?: string;
      real_name?: string;
    };
  };
}> {
  return slackAPI("users.info", { user: userId });
}

/**
 * Get conversation info (channel name, type, etc).
 */
export async function conversationsInfo(channel: string): Promise<{
  channel: {
    id: string;
    name?: string;
    is_channel: boolean;
    is_group: boolean;
    is_im: boolean;
    is_mpim: boolean;
  };
}> {
  return slackAPI("conversations.info", { channel });
}