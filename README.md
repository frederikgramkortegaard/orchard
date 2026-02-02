# Orchard

> **Note:** This project was fully vibe coded as an experiment in AI-assisted development. It serves as a meta-analysis of vibe coding itself - an AI orchestrator built entirely through vibe coding, managing other AI agents. The code, architecture, and even this README were generated through natural language conversations with Claude. Take it as a test, a proof of concept.

A multi-agent orchestrator for Claude Code that enables parallel AI coding workflows using git worktrees.

## Overview

Orchard coordinates multiple Claude Code agents working simultaneously on different features in isolated git worktrees. It provides a web dashboard for monitoring agent activity, reviewing changes, and managing the development workflow.

## Features

- **Worktree Management** - Create isolated git worktrees for each agent task, with automatic branch creation and merge capabilities
- **Agent Monitoring** - Real-time terminal output streaming, status indicators (working, idle, blocked), and pattern detection for completions/questions/errors
- **Activity Log** - Unified feed of all agent activities including file edits, commits, progress updates, and errors
- **Diff Viewer** - Side-by-side code diff visualization for reviewing agent changes before merging
- **Themes** - Dark mode and pink theme with toggle controls
- **Orchestrator Loop** - Autonomous coordination using LLM to manage agents, respond to questions, and execute tasks
- **Plan Mode** - Agents can propose implementation plans for approval before executing
- **Session Persistence** - Resume Claude sessions after interruption
- **MCP Integration** - Model Context Protocol servers for bidirectional agent-orchestrator communication

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 8+
- Git

### Installation

```bash
pnpm install
```

### Development

Start the development servers:

```bash
pnpm dev
```

This starts:
- Web UI at `http://localhost:5173`
- API server at `http://localhost:3001`

## Architecture

```
orchard/
├── apps/
│   ├── server/           # Fastify API server
│   │   └── src/
│   │       ├── routes/   # REST endpoints
│   │       └── services/ # Business logic
│   ├── web/              # React web UI
│   │   └── src/
│   │       ├── components/
│   │       └── stores/   # Zustand state
│   └── terminal-daemon/  # PTY session manager
├── packages/
│   ├── mcp-orchestrator/ # MCP tools for orchestrator
│   ├── mcp-agent/        # MCP tools for agents
│   └── shared/           # Shared TypeScript types
└── docs/
```

### Apps

**Server** (`apps/server`)
- Fastify 5 with TypeScript
- SQLite database via better-sqlite3
- WebSocket support for terminal streaming
- Routes: `/orchestrator`, `/agents`, `/worktrees`, `/projects`, `/terminals`, `/chat`, `/diff`

**Web** (`apps/web`)
- React 19 with TypeScript and Vite
- TailwindCSS for styling
- Monaco Editor for code viewing
- xterm.js for terminal rendering
- Zustand for state management

**Terminal Daemon** (`apps/terminal-daemon`)
- node-pty for pseudo-terminal management
- WebSocket multiplexing for terminal I/O

### Packages

**mcp-orchestrator** - MCP server providing tools for the orchestrator:
- `create_agent` - Spawn agents in new worktrees
- `list_agents` - List agents by status
- `send_task` - Send instructions to agents
- `get_agent_status` - Get agent output and status
- `merge_branch` - Merge completed work
- `archive_worktree` - Clean up worktrees

**mcp-agent** - MCP server for agents to communicate back:
- `report_completion` - Signal task completion
- `ask_question` - Request clarification
- `report_progress` - Send progress updates
- `report_error` - Report blockers
- `log_activity` - Log activities

**shared** - Common TypeScript types for Worktree, Project, Terminal, and WebSocket protocols.

## How It Works

1. User creates a project pointing to a git repository
2. User or orchestrator creates worktrees for feature tasks
3. Claude Code agents start in worktrees with MCP tools configured
4. Agents work autonomously, reporting progress via MCP
5. Orchestrator loop monitors agents and coordinates work
6. Completed features are reviewed via diff viewer and merged

## Configuration

### MCP Setup

Add to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "orchard": {
      "command": "node",
      "args": ["path/to/orchard/packages/mcp-orchestrator/dist/index.js"]
    },
    "orchard-agent": {
      "command": "node",
      "args": ["path/to/orchard/packages/mcp-agent/dist/index.js"],
      "env": {
        "WORKTREE_ID": "${WORKTREE_ID}"
      }
    }
  }
}
```

### Environment Variables

- `ORCHARD_API` - Server URL (default: `http://localhost:3001`)
- `WORKTREE_ID` - Auto-injected for agents in worktrees

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, TailwindCSS, Zustand
- **Backend**: Fastify 5, TypeScript, SQLite, WebSocket
- **Terminal**: node-pty, xterm.js
- **Protocols**: Model Context Protocol (MCP)

## License

MIT
