#!/bin/bash
# Archive a worktree by branch name or ID
# Usage: ./archive_worktree.sh <branch-name-or-id>

PROJECT_ID="5fa4a463-48c6-4b13-93fe-566d34411a8f"
TARGET="$1"

if [ -z "$TARGET" ]; then
  echo "Usage: $0 <branch-name-or-id>"
  exit 1
fi

# Try to find worktree by branch name first
WORKTREE_ID=$(curl -s "http://localhost:3001/worktrees?projectId=$PROJECT_ID" | \
  jq -r ".[] | select(.branch == \"$TARGET\" or .branch == \"feature/$TARGET\") | .id")

# If not found by branch, assume it's an ID
if [ -z "$WORKTREE_ID" ]; then
  WORKTREE_ID="$TARGET"
fi

curl -s -X POST "http://localhost:3001/worktrees/$WORKTREE_ID/archive" | \
  jq -r 'if .archived then "Archived: \(.branch)" else "Error: \(.error // "Unknown error")" end'
