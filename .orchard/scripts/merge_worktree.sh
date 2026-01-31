#!/bin/bash
# Merge a worktree branch into master
# Usage: ./merge_worktree.sh <branch-name>

PROJECT_PATH="/Users/fgk/Developer/orchard"
BRANCH="$1"

if [ -z "$BRANCH" ]; then
  echo "Usage: $0 <branch-name>"
  exit 1
fi

# Add feature/ prefix if not present
if [[ "$BRANCH" != feature/* ]]; then
  BRANCH="feature/$BRANCH"
fi

cd "$PROJECT_PATH" || exit 1
git merge "$BRANCH" -m "Merge $BRANCH" && echo "Merged $BRANCH into master" || echo "Merge failed"
