#!/bin/bash
# Check for new orchestrator messages
# Usage: ./check-new-messages.sh [project_id] [mark_processed]

PROJECT_ID="${1:-5fa4a463-48c6-4b13-93fe-566d34411a8f}"
MARK_PROCESSED="${2:-false}"

# Check via API
MESSAGES=$(curl -s "http://localhost:3001/messages?projectId=$PROJECT_ID&markProcessed=$MARK_PROCESSED" 2>/dev/null)

if [ -z "$MESSAGES" ] || [ "$MESSAGES" = "[]" ]; then
  echo "No pending messages"
  exit 0
fi

COUNT=$(echo "$MESSAGES" | jq 'length')
echo "=== $COUNT Pending Messages ==="
echo "$MESSAGES" | jq -r '.[] | "[\(.timestamp)] \(.text)"'
echo ""

if [ "$MARK_PROCESSED" = "true" ]; then
  echo "(Messages marked as processed)"
fi
