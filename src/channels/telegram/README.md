# Telegram Channel Setup

This guide walks you through setting up the Telegram channel so your agent can receive and respond to messages via a Telegram bot.

## Prerequisites

- An [Inngest account](https://app.inngest.com) with Event Key and Signing Key
- A Telegram account

## 1. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts to choose a name and username
3. Copy the bot token (looks like `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)

### Optional: Configure Privacy Mode

By default, bots only receive messages that directly mention them in groups. To receive all messages:

1. Message @BotFather
2. Send `/setprivacy`
3. Select your bot
4. Choose `Disable`

This is only needed if you want the bot to respond to all messages in group chats, not just @mentions.

## 2. Set Environment Variables

Add the following to your `.env` file:

```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
```

### Optional: Restrict to Specific Chats

To limit which chats the bot responds in, set a comma-separated list of chat IDs:

```env
TELEGRAM_ALLOWED_CHATS=123456789,-100987654321
```

To find a chat ID, you can message the bot and check the logs — the chat ID is printed when messages are received. Group chat IDs are typically negative numbers.

## 3. Run Setup

Start the worker:

```bash
npm start
```

On startup, the setup script will automatically:

1. Validate the bot token via Telegram's `getMe` API
2. Create (or update) an Inngest webhook with the Telegram transform
3. Set the Telegram bot's webhook to point at the Inngest webhook URL
4. Report any webhook errors if they exist

Look for output like:

```
🤖 Bot: @your_bot (Your Bot Name)
🔍 Checking Inngest webhooks...
   ✅ Transform is up to date
🔍 Checking Telegram webhook...
   ✅ Telegram webhook already set
```

No manual webhook configuration is needed — it's fully automated.

## 4. Start Chatting

Send a message to your bot on Telegram and you should see the agent process it in the terminal and reply.

- **Direct messages**: Just message the bot
- **Group chats**: Add the bot to a group. It will receive all messages if privacy mode is disabled, or only @mentions if privacy mode is enabled

## How It Works

- Telegram sends updates to the Inngest webhook URL (configured automatically)
- The webhook transform converts Telegram payloads into normalized `agent.message.received` events
- The agent processes the message and sends replies back via the Telegram Bot API
- Messages are acknowledged with a typing indicator
- Long messages are split at 4,000 characters (Telegram's limit is 4,096)
- Replies are sent with HTML formatting
- Forum topics (thread IDs) are preserved for Telegram supergroups with topics enabled
