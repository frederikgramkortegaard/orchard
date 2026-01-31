#!/bin/bash
# Read recent chat messages
# Usage: ./read_chat.sh [limit]

PROJECT_ID="5fa4a463-48c6-4b13-93fe-566d34411a8f"
LIMIT="${1:-20}"

curl -s "http://localhost:3001/chat?projectId=$PROJECT_ID&limit=$LIMIT" | jq -r '.[] | "\(.timestamp | split("T")[1] | split(".")[0]) [\(.from)]: \(.text)"'
