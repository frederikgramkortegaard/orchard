#!/bin/bash
# Send a message to the user via chat
# Usage: ./send_message.sh "Your message here"

PROJECT_ID="5fa4a463-48c6-4b13-93fe-566d34411a8f"
MESSAGE="$1"

if [ -z "$MESSAGE" ]; then
  echo "Usage: $0 \"message\""
  exit 1
fi

# Use printf to avoid bash escaping issues
printf '{"projectId":"%s","text":"%s","from":"orchestrator"}' "$PROJECT_ID" "$MESSAGE" | \
  curl -s -X POST http://localhost:3001/chat -H "Content-Type: application/json" -d @- | \
  jq -r '.message.text // .error // "Message sent"'
