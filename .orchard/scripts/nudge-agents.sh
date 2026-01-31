#!/bin/bash
# Send enter presses to all agent sessions to nudge them
# Usage: ./nudge-agents.sh

SESSIONS=$(curl -s http://localhost:3001/terminals 2>/dev/null)

if [ -z "$SESSIONS" ]; then
  echo "No sessions found or server not running"
  exit 1
fi

echo "=== Nudging Agent Sessions ==="

echo "$SESSIONS" | jq -r '.[] | select(.cwd | contains(".worktrees")) | "\(.id)|\(.cwd)"' | while IFS='|' read SESSION_ID CWD; do
  BRANCH=$(basename "$CWD")

  # Send enter
  RESULT=$(curl -s -X POST "http://localhost:3001/terminals/$SESSION_ID/input" \
    -H "Content-Type: application/json" \
    -d '{"input": "", "sendEnter": true}' 2>/dev/null)

  if echo "$RESULT" | grep -q "success"; then
    echo "[$BRANCH] Nudged session $SESSION_ID"
  else
    echo "[$BRANCH] Failed to nudge: $RESULT"
  fi
done

echo ""
echo "Done!"
