#!/bin/bash
# Log orchestrator activity
# Usage: ./log_activity.sh "What you did"

PROJECT_ID="5fa4a463-48c6-4b13-93fe-566d34411a8f"
MESSAGE="$1"

if [ -z "$MESSAGE" ]; then
  echo "Usage: $0 \"message\""
  exit 1
fi

curl -s -X POST http://localhost:3001/orchestrator/log \
  -H "Content-Type: application/json" \
  --data-raw "{\"projectId\":\"$PROJECT_ID\",\"message\":\"$MESSAGE\"}" | jq -r '.timestamp // .error'
