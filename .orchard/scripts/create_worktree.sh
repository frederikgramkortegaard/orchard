#!/bin/bash
# Create a new worktree with a feature branch
# Usage: ./create_worktree.sh <feature-name>

FEATURE_NAME="$1"

if [ -z "$FEATURE_NAME" ]; then
  echo "Usage: $0 <feature-name>"
  exit 1
fi

# Add feature/ prefix if not present
if [[ "$FEATURE_NAME" != feature/* ]]; then
  BRANCH_NAME="feature/$FEATURE_NAME"
else
  BRANCH_NAME="$FEATURE_NAME"
fi

# Create folder name from feature name
FOLDER_NAME=$(echo "$FEATURE_NAME" | sed 's/feature\///' | tr '/' '-')

git worktree add ".worktrees/$FOLDER_NAME" -b "$BRANCH_NAME" && \
  echo "Created worktree: .worktrees/$FOLDER_NAME on branch $BRANCH_NAME"
