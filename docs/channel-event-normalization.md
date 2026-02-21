# Channel Event Normalization

How different channel webhooks map to a normalized `agent.message.received` event, with channel-specific metadata passed through.

## The Problem

Each channel sends very different webhook payloads:

### Telegram
```json
{
  "update_id": 123,
  "message": {
    "message_id": 456,
    "from": { "id": 789, "first_name": "Dan", "username": "djfarrelly" },
    "chat": { "id": -100123, "type": "group", "title": "Team Chat" },
    "text": "Hey Utah",
    "reply_to_message": { "message_id": 455, "text": "..." }
  }
}
```

### Slack
```json
{
  "event": {
    "type": "message",
    "text": "Hey Utah",
    "user": "U123ABC",
    "channel": "C456DEF",
    "ts": "1629300000.000100",
    "thread_ts": "1629299000.000050",
    "team": "T789GHI"
  }
}
```

### Discord
```json
{
  "t": "MESSAGE_CREATE",
  "d": {
    "id": "123456789",
    "content": "Hey Utah",
    "author": { "id": "987654", "username": "djfarrelly" },
    "channel_id": "111222333",
    "guild_id": "444555666",
    "message_reference": { "message_id": "123456788" }
  }
}
```

### WhatsApp (via webhooks)
```json
{
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "18001234567",
          "id": "wamid.xxx",
          "text": { "body": "Hey Utah" },
          "type": "text"
        }],
        "contacts": [{ "profile": { "name": "Dan" }, "wa_id": "18001234567" }]
      }
    }]
  }]
}
```

## Normalized Event

All of the above should transform into the same `agent.message.received` event with two layers:

1. **Standard fields** — same across all channels, used by the agent loop
2. **Channel metadata** — channel-specific data, passed through to channel handlers

```typescript
interface AgentMessageEvent {
  name: "agent.message.received";
  data: {
    // --- Standard fields (used by agent loop) ---
    message: string;            // The text content
    sessionKey: string;         // Unique session identifier (channel-chatId)
    channel: string;            // "telegram" | "slack" | "discord" | "whatsapp"
    
    // --- Sender info (normalized) ---
    sender: {
      id: string;              // Channel-specific user ID
      name: string;            // Display name
      username?: string;       // Handle/username if available
    };
    
    // --- Destination (where to send replies) ---
    destination: {
      chatId: string;          // Primary destination (chat/channel/DM)
      messageId?: string;      // Message to reply to or react to
      threadId?: string;       // Thread context (Slack thread_ts, Discord thread, Telegram topic)
    };
    
    // --- Channel metadata (opaque to agent, passed to channel handlers) ---
    channelMeta: Record<string, unknown>;
  };
}
```

## Channel Metadata

The `channelMeta` field carries channel-specific data that only the channel handler understands. The agent loop never reads it — it flows through to `sendReply()` and `acknowledge()`.

### Telegram `channelMeta`
```typescript
{
  chatType: "private" | "group" | "supergroup" | "channel";
  chatTitle?: string;           // Group/channel name
  replyToMessage?: {            // If user replied to a specific message
    messageId: number;
    text?: string;
  };
  forumTopicId?: number;        // Telegram forum/topic thread
}
```

### Slack `channelMeta`
```typescript
{
  teamId: string;               // Workspace ID
  channelType: "channel" | "group" | "im" | "mpim";
  threadTs?: string;            // Thread timestamp — replies go here
  eventTs: string;              // Event timestamp (for reactions)
  parentUserId?: string;        // If in a thread, who started it
}
```

### Discord `channelMeta`
```typescript
{
  guildId?: string;             // Server ID (null for DMs)
  channelType: number;          // Discord channel type enum
  messageReference?: {          // If user replied to something
    messageId: string;
    channelId: string;
  };
}
```

### WhatsApp `channelMeta`
```typescript
{
  phoneNumber: string;          // Sender's phone number
  waMessageId: string;          // WhatsApp message ID (for read receipts)
  profileName: string;          // WhatsApp profile name
}
```

## How It Flows

```
Webhook payload
  → Inngest transform (per-channel JS, runs in Inngest Cloud)
  → Normalized agent.message.received event
  → agent loop (reads: message, sessionKey, sender)
  → agent.reply.ready event (passes through: channel, destination, channelMeta)
  → send-reply function
  → getChannel(channel).sendReply({ response, destination, channelMeta })
  → channel handler formats + sends using channelMeta
```

## Updated Interfaces

```typescript
interface ChannelHandler {
  sendReply(params: SendReplyParams): Promise<void>;
  acknowledge(params: AcknowledgeParams): Promise<void>;
  setup?(): Promise<void>;
}

interface SendReplyParams {
  response: string;
  destination: Destination;
  channelMeta: Record<string, unknown>;
}

interface AcknowledgeParams {
  destination: Destination;
  channelMeta: Record<string, unknown>;
}

interface Destination {
  chatId: string;
  messageId?: string;
  threadId?: string;
}
```

## Transform Examples

### Telegram Transform
```javascript
function transform(evt) {
  if (!evt.message?.text) return { name: "telegram/message.unsupported", data: evt };
  var msg = evt.message;
  return {
    name: "agent.message.received",
    data: {
      message: msg.text,
      sessionKey: "telegram-" + msg.chat.id,
      channel: "telegram",
      sender: {
        id: String(msg.from.id),
        name: msg.from.first_name,
        username: msg.from.username
      },
      destination: {
        chatId: String(msg.chat.id),
        messageId: String(msg.message_id),
        threadId: msg.message_thread_id ? String(msg.message_thread_id) : undefined
      },
      channelMeta: {
        chatType: msg.chat.type,
        chatTitle: msg.chat.title,
        replyToMessage: msg.reply_to_message ? {
          messageId: msg.reply_to_message.message_id,
          text: msg.reply_to_message.text
        } : undefined
      }
    }
  };
}
```

### Slack Transform
```javascript
function transform(evt) {
  if (!evt.event || evt.event.type !== "message" || evt.event.bot_id) return undefined;
  var e = evt.event;
  return {
    name: "agent.message.received",
    data: {
      message: e.text,
      sessionKey: "slack-" + (e.thread_ts || e.channel + "-" + e.ts),
      channel: "slack",
      sender: {
        id: e.user,
        name: e.user  // Slack requires a separate API call for display name
      },
      destination: {
        chatId: e.channel,
        messageId: e.ts,
        threadId: e.thread_ts || e.ts  // Always reply in thread
      },
      channelMeta: {
        teamId: evt.team_id,
        channelType: e.channel_type,
        threadTs: e.thread_ts,
        eventTs: e.event_ts
      }
    }
  };
}
```

## Key Decisions

1. **`sessionKey` is constructed by the transform** — each channel decides what constitutes a "session" (Telegram: per-chat, Slack: per-thread, Discord: per-channel or per-thread)

2. **`destination` replaces flat `chatId`/`messageId`** — adds `threadId` which is critical for Slack (thread_ts) and Discord (thread channels)

3. **`channelMeta` is opaque** — the agent loop and core functions never inspect it. It flows through events untouched and only the channel handler reads it.

4. **`sender` is normalized** — agent can use sender.name in responses regardless of channel

5. **Transforms run in Inngest Cloud** — plain JS only, no imports. Each channel has its own transform synced by the setup script.
