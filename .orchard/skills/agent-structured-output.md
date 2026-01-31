# Agent Structured Output Protocol

## Overview
Agents communicate with the orchestrator using structured JSON messages in fenced code blocks. This provides richer data than plain text markers and enables automated parsing by the terminal-daemon.

## Message Format

Use the `orchestrator-message` language identifier in fenced code blocks:

```orchestrator-message
{
  "type": "MESSAGE_TYPE",
  "data": { ... }
}
```

## Supported Message Types

### TASK_COMPLETE
Signal successful task completion with optional metadata.

```orchestrator-message
{
  "type": "TASK_COMPLETE",
  "data": {
    "summary": "Brief description of what was accomplished",
    "filesChanged": ["path/to/file1.ts", "path/to/file2.ts"],
    "commitHash": "abc123"
  }
}
```

### QUESTION
Request clarification or input from the orchestrator.

```orchestrator-message
{
  "type": "QUESTION",
  "data": {
    "question": "Which authentication method should I use?",
    "options": ["JWT", "Session-based", "OAuth2"],
    "context": "The existing codebase has no auth implementation"
  }
}
```

### BLOCKED
Indicate that progress is blocked and why.

```orchestrator-message
{
  "type": "BLOCKED",
  "data": {
    "reason": "Cannot access external API",
    "details": "The API endpoint returns 403 Forbidden",
    "suggestedAction": "Check API credentials in .env"
  }
}
```

### STATUS_UPDATE
Provide progress updates during long-running tasks.

```orchestrator-message
{
  "type": "STATUS_UPDATE",
  "data": {
    "progress": 75,
    "currentStep": "Running test suite",
    "totalSteps": 4,
    "completedSteps": ["Setup", "Implementation", "Linting"]
  }
}
```

### ERROR
Report errors that don't block the task but should be noted.

```orchestrator-message
{
  "type": "ERROR",
  "data": {
    "message": "Test file not found",
    "severity": "warning",
    "file": "src/utils.test.ts",
    "recoverable": true
  }
}
```

### REQUEST_REVIEW
Request code review or approval before proceeding.

```orchestrator-message
{
  "type": "REQUEST_REVIEW",
  "data": {
    "description": "API endpoint implementation ready for review",
    "files": ["src/api/users.ts", "src/api/users.test.ts"],
    "notes": "Added rate limiting as discussed"
  }
}
```

## Backwards Compatibility

The legacy text-based markers are still supported:
- `:ORCHESTRATOR: TASK COMPLETE` - Task finished
- `:ORCHESTRATOR: QUESTION - <question>` - Needs clarification
- `:ORCHESTRATOR: BLOCKED - <reason>` - Stuck on something

However, structured messages are preferred as they provide more context.

## Best Practices

1. **Always include type**: Every message must have a `type` field
2. **Keep data relevant**: Only include necessary fields in `data`
3. **Use specific types**: Choose the most appropriate message type
4. **Provide context**: Include enough detail for the orchestrator to act
5. **One message per block**: Each code block should contain one message

## Example Workflow

Agent starting a task:
```orchestrator-message
{
  "type": "STATUS_UPDATE",
  "data": {
    "progress": 0,
    "currentStep": "Analyzing requirements"
  }
}
```

Agent encountering an issue:
```orchestrator-message
{
  "type": "QUESTION",
  "data": {
    "question": "The database schema differs from the spec. Should I update the schema or adapt the code?",
    "options": ["Update schema", "Adapt code", "Ask user"]
  }
}
```

Agent completing task:
```orchestrator-message
{
  "type": "TASK_COMPLETE",
  "data": {
    "summary": "Implemented user authentication with JWT",
    "filesChanged": ["src/auth/jwt.ts", "src/middleware/auth.ts", "src/routes/login.ts"],
    "commitHash": "a1b2c3d"
  }
}
```
