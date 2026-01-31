#!/bin/bash
# Check for :ORCHESTRATOR: messages from all agent sessions
# Usage: ./check-agent-messages.sh [project_path]

PROJECT_PATH="${1:-.}"
ORCHARD_DIR="$PROJECT_PATH/.orchard"

# Get all terminal sessions
SESSIONS=$(curl -s http://localhost:3001/terminals 2>/dev/null)

if [ -z "$SESSIONS" ]; then
  echo "No sessions found or server not running"
  exit 1
fi

echo "=== Agent Messages ==="
echo "$SESSIONS" | jq -r '.[] | select(.cwd | contains(".worktrees")) | .id' | while read SESSION_ID; do
  # Get session info
  CWD=$(echo "$SESSIONS" | jq -r ".[] | select(.id == \"$SESSION_ID\") | .cwd")
  BRANCH=$(basename "$CWD")

  # Check for orchestrator messages in recent output (would need daemon buffer endpoint)
  echo "[$BRANCH] Session: $SESSION_ID"
done

echo ""
echo "Note: Full session buffer inspection requires daemon /buffer endpoint"
