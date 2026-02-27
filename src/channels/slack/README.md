# Slack Channel Setup

This guide walks you through setting up the Slack channel so your agent can receive and respond to messages in Slack.

## Prerequisites

- An [Inngest account](https://app.inngest.com) with Event Key and Signing Key
- A Slack workspace where you can create apps

## 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**
2. Choose **From scratch**
3. Give it a name (e.g. your agent's name) and select your workspace
4. Click **Create App**

## 2. Configure Bot Permissions

1. In your app settings, go to **OAuth & Permissions**
2. Under **Bot Token Scopes**, add the following scopes:
   - `app_mentions:read` - View messages that directly mention the bot
   - `chat:write` — Send messages
   - `reactions:write` — Add emoji reactions (used for message acknowledgment)
   - `users:read` — Look up user display names
   - `channels:read` — Get channel info
   - `im:read` — (Optional) Get DM info
   - `mpim:read` — (Optional) Get group DM info
   - `im:history` — (Optional) Read direct messages
   - `mpim:history` — (Optional) Read group direct messages
   - `channels:history` — (Optional) Read messages in public channels
3. Click **Install to Workspace** and authorize the app
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

## 3. Set Environment Variables

Add the following to your `.env` file:

```env
SLACK_BOT_TOKEN=xoxb-your-token-here
```

The `SLACK_SIGNING_SECRET` is available in your app's **Basic Information** page under **App Credentials**, but is not currently required.

## 4. Run Setup

Start the worker:

```bash
npm start
```

On startup, the setup script will:

1. Validate your bot token via Slack's `auth.test` API
2. Create (or update) an Inngest webhook with the Slack transform and response handler
3. Print the webhook URL you need for the next step

Look for output like:

```
💬 Slack Bot: your-bot-name (Team: Your Workspace)
📋 Slack webhook URL: https://inn.gs/...
   Configure this URL in your Slack app's Event Subscriptions settings
```

## 5. Configure Event Subscriptions

1. Back in your Slack app settings, go to **Event Subscriptions**
2. Toggle **Enable Events** to On
3. Paste the Inngest webhook URL into the **Request URL** field
   - Slack will send a verification challenge — the webhook's response handler answers this automatically
4. Under **Subscribe to bot events**, add:
   - `app_mention` - Only subscribe to events that mention the bot
   - `message.im` — Direct messages to the bot
   - `message.mpim` — Group DMs the bot is in
   - `reaction_added` - Reactions to messages
5. Click **Save Changes**

## 6. Invite the Bot

The bot will only receive messages in channels it has been invited to:

- For public/private channels: invite the bot with `/invite @your-bot-name`
- For DMs: just message the bot directly

## How It Works

- Slack sends events to the Inngest webhook URL
- The webhook transform converts Slack payloads into normalized `agent.message.received` events
- A response handler answers Slack's URL verification challenge
- The agent processes the message and sends replies back via the Slack Web API
- Messages are acknowledged with a 👀 emoji reaction
- Replies are threaded — the bot always replies in a thread
- Long messages are split at ~3,900 characters (Slack's limit is 4,000)
- Slack retries are detected via `x-slack-retry-num` header and filtered out to prevent duplicate processing
