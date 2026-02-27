#!/usr/bin/env bash
#
# Test Slack app_mention event against an Inngest webhook.
#
# Usage: ./scripts/test-slack-app-mention.sh <webhook-url>

set -euo pipefail

WEBHOOK_URL="${1:?Usage: $0 <webhook-url>}"
EVENT_TIME="$(date +%s)"
TS="${EVENT_TIME}.000100"

echo "POST $WEBHOOK_URL"
echo "Event: app_mention"
echo "Timestamp: $TS"
echo ""

curl -i \
  -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "{
  \"type\": \"event_callback\",
  \"team_id\": \"T_TEST\",
  \"event_id\": \"Ev_TEST\",
  \"event_time\": $EVENT_TIME,
  \"event\": {
    \"type\": \"app_mention\",
    \"channel\": \"C_TEST\",
    \"user\": \"U_TEST\",
    \"text\": \"<@U_BOT> hello from test script\",
    \"ts\": \"$TS\",
    \"channel_type\": \"channel\"
  }
}"
