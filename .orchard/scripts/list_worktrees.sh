#!/bin/bash
# List all worktrees with their status
# Usage: ./list_worktrees.sh [filter: merged|archived|active]

PROJECT_ID="5fa4a463-48c6-4b13-93fe-566d34411a8f"
FILTER="$1"

WORKTREES=$(curl -s "http://localhost:3001/worktrees?projectId=$PROJECT_ID")

case "$FILTER" in
  merged)
    echo "$WORKTREES" | jq -r '.[] | select(.merged == true) | "\(.branch)\t[MERGED]"'
    ;;
  archived)
    echo "$WORKTREES" | jq -r '.[] | select(.archived == true) | "\(.branch)\t[ARCHIVED]"'
    ;;
  active)
    echo "$WORKTREES" | jq -r '.[] | select(.archived == false and .merged == false) | "\(.branch)\t[ACTIVE]"'
    ;;
  *)
    echo "$WORKTREES" | jq -r '.[] | "\(.branch)\t\(if .archived then "[ARCHIVED]" elif .merged then "[MERGED]" else "[ACTIVE]" end)"'
    ;;
esac
