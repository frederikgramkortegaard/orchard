# Orchestrator Agent Management Skill

## Overview
The orchestrator Claude manages multiple Claude agent sessions working on feature branches.

## Creating Feature Agents
```bash
curl -X POST http://localhost:3001/orchestrator/create-feature \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "<project-id>",
    "name": "feature-name",
    "description": "Task description for the agent"
  }'
```

## Sending Tasks to Agents
```bash
# Send input to a terminal session
curl -X POST "http://localhost:3001/terminals/<session-id>/input" \
  -H "Content-Type: application/json" \
  -d '{"input": "Your task here", "sendEnter": true}'
```

**IMPORTANT**: Always set `sendEnter: true` to actually submit the prompt!

## Monitoring Agent Progress

### Quick Commands
```bash
# Get status of all agent worktrees
./.orchard/scripts/agent-status.sh

# Nudge all agents (send enter to stuck sessions)
./.orchard/scripts/nudge-agents.sh

# Check for orchestrator messages
./.orchard/scripts/check-agent-messages.sh
```

### Manual Commands
```bash
# Check git status of worktrees
for branch in .worktrees/feature-*; do
  echo "=== $(basename $branch) ===" && git -C "$branch" status --short
done

# List active sessions
curl -s http://localhost:3001/terminals | jq '.[] | {id, cwd: (.cwd | split("/") | .[-1])}'
```

## Communication Protocol
Agents should use structured messages for orchestrator to detect:
- `:ORCHESTRATOR: TASK COMPLETE` - Task finished
- `:ORCHESTRATOR: QUESTION - <question>` - Needs clarification
- `:ORCHESTRATOR: BLOCKED - <reason>` - Stuck on something

## Common Issues
1. **Bypass permissions prompt**: The daemon auto-accepts, but may need extra enters
2. **Session IDs mismatch**: Use deterministic IDs (hash of projectId:path)
3. **Tasks not starting**: Send extra `\r` (enter) presses before/after task

## Archiving Worktrees
When a worktree is done and you won't send any more tasks to it:
```bash
# Archive a worktree (closes its Claude session)
curl -X POST "http://localhost:3001/worktrees/<worktree-id>/archive"
```

Use this when:
- The feature is complete and merged
- The worktree has been idle for a long time
- You're sure no more work will be done on it

Note: Merged status is automatic - the system checks if all branch commits exist in main.

## Workflow
1. Create feature branch with agent via orchestrator
2. Wait for bypass prompt to be auto-accepted
3. Send task with `sendEnter: true`
4. Monitor progress via git status
5. Merge completed features to master
6. Archive worktrees that are done (closes sessions)
