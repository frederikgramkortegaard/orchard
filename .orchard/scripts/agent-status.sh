#!/bin/bash
# Quick status of all agent worktrees
# Usage: ./agent-status.sh [project_path]

PROJECT_PATH="${1:-.}"
WORKTREES_DIR="$PROJECT_PATH/.worktrees"

if [ ! -d "$WORKTREES_DIR" ]; then
  echo "No worktrees directory found at $WORKTREES_DIR"
  exit 1
fi

echo "=== Agent Worktrees Status ==="
echo ""

for WORKTREE in "$WORKTREES_DIR"/*; do
  if [ -d "$WORKTREE" ]; then
    BRANCH=$(basename "$WORKTREE")

    # Get git status
    MODIFIED=$(git -C "$WORKTREE" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    AHEAD=$(git -C "$WORKTREE" rev-list --count HEAD ^origin/master 2>/dev/null || echo "0")
    LAST_COMMIT=$(git -C "$WORKTREE" log -1 --format="%ar: %s" 2>/dev/null | head -c 60)

    # Check if merged into master (branch tip exists in master history)
    MERGED="no"
    BRANCH_TIP=$(git -C "$WORKTREE" rev-parse HEAD 2>/dev/null)
    if git -C "$PROJECT_PATH" merge-base --is-ancestor "$BRANCH_TIP" master 2>/dev/null; then
      MERGED="yes"
    fi

    # Status indicator
    if [ "$MODIFIED" -gt 0 ]; then
      STATUS="[WORKING]"
    elif [ "$MERGED" = "yes" ]; then
      STATUS="[MERGED]"
    elif [ "$AHEAD" -gt 0 ]; then
      STATUS="[READY]"
    else
      STATUS="[IDLE]"
    fi

    echo "$STATUS $BRANCH"
    echo "         Modified: $MODIFIED | Ahead: $AHEAD | Merged: $MERGED"
    echo "         Last: $LAST_COMMIT"
    echo ""
  fi
done
