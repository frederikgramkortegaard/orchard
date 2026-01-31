#!/bin/bash
# Start a Claude agent in a worktree
# Usage: ./start_agent.sh <branch-name> "<task-description>"

PROJECT_ID="5fa4a463-48c6-4b13-93fe-566d34411a8f"
PROJECT_PATH="/Users/fgk/Developer/orchard"
BRANCH="$1"
TASK="$2"

if [ -z "$BRANCH" ] || [ -z "$TASK" ]; then
  echo "Usage: $0 <branch-name> \"<task-description>\""
  exit 1
fi

# Get worktree info
WORKTREE_JSON=$(curl -s "http://localhost:3001/worktrees?projectId=$PROJECT_ID" | \
  jq -r ".[] | select(.branch == \"$BRANCH\" or .branch == \"feature/$BRANCH\")")

if [ -z "$WORKTREE_JSON" ]; then
  echo "Worktree not found for branch: $BRANCH"
  exit 1
fi

WORKTREE_ID=$(echo "$WORKTREE_JSON" | jq -r '.id')
WORKTREE_PATH=$(echo "$WORKTREE_JSON" | jq -r '.path')

# Create terminal session with Claude
SESSION_JSON=$(printf '{"worktreeId":"%s","projectPath":"%s","cwd":"%s","initialCommand":"claude"}' \
  "$WORKTREE_ID" "$PROJECT_PATH" "$WORKTREE_PATH" | \
  curl -s -X POST http://localhost:3001/terminals -H "Content-Type: application/json" -d @-)

SESSION_ID=$(echo "$SESSION_JSON" | jq -r '.id')

if [ "$SESSION_ID" == "null" ] || [ -z "$SESSION_ID" ]; then
  echo "Failed to create terminal session"
  exit 1
fi

# Wait for Claude to start
sleep 3

# Send the task
printf '{"input":"%s\\n\\nLet me know when done with :ORCHESTRATOR: TASK COMPLETE","sendEnter":true}' "$TASK" | \
  curl -s -X POST "http://localhost:3001/terminals/$SESSION_ID/input" -H "Content-Type: application/json" -d @- > /dev/null

echo "Agent started in $BRANCH (session: $SESSION_ID)"
echo "Task: $TASK"
