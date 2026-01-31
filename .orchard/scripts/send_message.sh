#!/bin/bash
# Send a message to the user via chat
# Usage: ./send_message.sh "Your message here"

PROJECT_ID="5fa4a463-48c6-4b13-93fe-566d34411a8f"
MESSAGE="$1"

if [ -z "$MESSAGE" ]; then
  echo "Usage: $0 \"message\""
  exit 1
fi

curl -s -X POST http://localhost:3001/chat \
  -H "Content-Type: application/json" \
  --data-raw "{\"projectId\":\"$PROJECT_ID\",\"text\":\"$MESSAGE\",\"from\":\"orchestrator\"}" | jq -r '.message.text // .error'
