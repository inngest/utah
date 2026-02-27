#!/usr/bin/env bash
#
# Test Slack URL verification challenge against an Inngest webhook.
#
# Usage: ./scripts/test-slack-challenge.sh <webhook-url>

set -euo pipefail

WEBHOOK_URL="${1:?Usage: $0 <webhook-url>}"
CHALLENGE="test_challenge_$(date +%s)"

echo "POST $WEBHOOK_URL"
echo "Challenge: $CHALLENGE"
echo ""

# "\n\nHTTP Status: %{http_code}\n" \
curl -i \
  -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"url_verification\",\"challenge\":\"$CHALLENGE\"}"
