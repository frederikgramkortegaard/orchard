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

# Set up Claude permissions for the worktree
WORKTREE_PATH="$(pwd)/.worktrees/$FOLDER_NAME"
PROJECT_PATH="$(pwd)"

mkdir -p "$WORKTREE_PATH/.claude"
cat > "$WORKTREE_PATH/.claude/settings.local.json" << EOF
{
  "trust": true,
  "permissions": {
    "allow": [
      "Bash($PROJECT_PATH/**)",
      "Read($PROJECT_PATH/**)",
      "Write($PROJECT_PATH/**)",
      "Edit($PROJECT_PATH/**)",
      "Bash($WORKTREE_PATH/**)",
      "Read($WORKTREE_PATH/**)",
      "Write($WORKTREE_PATH/**)",
      "Edit($WORKTREE_PATH/**)"
    ],
    "deny": []
  }
}
EOF
echo "Set up Claude permissions for worktree"
