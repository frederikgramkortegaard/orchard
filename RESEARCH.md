# Orchard Project Research

## Executive Summary

**Orchard** is a multi-agent orchestrator for Claude Code that enables parallel AI coding workflows using git worktrees. It provides a web dashboard for monitoring agent activity, reviewing changes, and managing the development workflow.

### One-liner descriptions

- **Technical:** "A web-based orchestration platform for managing parallel Claude Code agents in isolated git worktrees with real-time visibility and MCP integration."

- **User-friendly:** "Run multiple AI coding agents in parallel on your codebase, each working on its own feature branch, with a dashboard to monitor their progress and merge their work."

---

## What Orchard Does

### Core Functionality

1. **Worktree Management** - Creates isolated git worktrees for each agent task, with automatic branch creation and merge capabilities
2. **Agent Monitoring** - Real-time terminal output streaming, status indicators (working, idle, blocked), and pattern detection for completions/questions/errors
3. **Activity Log** - Unified feed of all agent activities including file edits, commits, progress updates, and errors
4. **Diff Viewer** - Side-by-side code diff visualization for reviewing agent changes before merging
5. **MCP Integration** - Bidirectional communication between orchestrator and agents via Model Context Protocol
6. **Plan Mode** - Agents can propose implementation plans for approval before executing

### Architecture

```
orchard/
├── apps/
│   ├── server/           # Fastify API server (SQLite, WebSocket)
│   ├── web/              # React web dashboard (Monaco Editor, xterm.js)
│   └── terminal-daemon/  # PTY session manager
├── packages/
│   ├── mcp-orchestrator/ # MCP tools for the orchestrator
│   ├── mcp-agent/        # MCP tools for agents to report back
│   └── shared/           # Shared TypeScript types
```

---

## Competitive Landscape

### Similar Tools

| Tool | Type | Parallelism | UI | Git Isolation | MCP |
|------|------|-------------|-----|---------------|-----|
| **Orchard** | Web dashboard | Multiple agents | Web GUI | Git worktrees | Yes (bidirectional) |
| **Claude Squad** | Terminal app | Multiple agents | TUI (tmux) | Git worktrees | No |
| **claude-worktree (cwt)** | Terminal app | Manual | TUI | Git worktrees | No |
| **Conductor (Melty)** | Desktop app | Multiple agents | Desktop GUI | Git worktrees | Unknown |
| **Pochi** | VS Code extension | Parallel agents | IDE panel | Git worktrees | Unknown |
| **ccswarm** | CLI orchestrator | Specialized agents | Minimal | Git worktrees | Custom (ACP) |
| **Cursor 2.0** | IDE | Up to 8 agents | IDE | Worktrees/remote | No |
| **Claude Code (built-in)** | CLI | Subagents | None | Same directory | N/A |

### Key Competitors

#### Claude Squad
The most popular open-source option. Uses tmux for terminal sessions and git worktrees for isolation. Pure terminal interface - good for CLI purists but lacks visual oversight.

#### Pochi
VS Code extension with parallel agents and inline code review features. IDE-integrated, which means great for VS Code users but locked to that ecosystem.

#### Cursor 2.0
Commercial IDE with up to 8 parallel agents. Full-featured but proprietary and requires their IDE.

#### ccswarm
Multi-agent orchestration with specialized agents (Frontend, Backend, DevOps, QA). Uses Agent Client Protocol rather than MCP.

---

## What Makes Orchard Unique

### Key Differentiators

1. **Web-based Dashboard**
   - Most alternatives are terminal-only (Claude Squad, cwt) or IDE-locked (Pochi, Cursor)
   - Web UI provides visibility without terminal management overhead
   - Accessible from any browser - good for team environments

2. **Bidirectional MCP Integration**
   - Two MCP servers: one for orchestrator commands, one for agent reports
   - Agents can report progress, ask questions, log activities back to the orchestrator
   - Follows the emerging MCP standard (now under Linux Foundation)

3. **Unified Activity Feed**
   - Aggregates all agent activities in one view
   - File edits, commits, progress updates, errors all visible in real-time
   - Reduces the "detective work" problem of debugging parallel agents

4. **Diff Viewer for Code Review**
   - Visual code review before merging agent work
   - Monaco-based side-by-side comparison
   - Critical for quality control of AI-generated code

5. **Plan Mode**
   - Agents propose implementation plans before executing
   - Human-in-the-loop approval workflow
   - Addresses the trust/control balance in AI coding

### Addressing Industry Pain Points

The competitive landscape shows a common challenge: **observability**. As noted in research, "When agents conflict or get stuck in loops, figuring out what went wrong requires detective work that can eat up all the time you supposedly saved."

Orchard directly addresses this with:
- Real-time terminal streaming
- Status pattern detection (working/idle/blocked)
- Activity logging with structured types
- Unified dashboard view across all agents

---

## Target Audience

### Primary Users

1. **Individual Developers**
   - Running multiple features in parallel
   - Want visibility into AI agent work
   - Need code review before merging

2. **Small Teams**
   - Shared visibility into AI-assisted development
   - Consistent workflow across team members
   - Integration with existing git workflows

3. **AI-First Development Shops**
   - Heavy users of Claude Code or similar tools
   - Need to scale AI coding beyond single-agent workflows
   - Value MCP ecosystem integration

### Use Cases

- **Feature parallelization**: Implement 5-10 features simultaneously, each in its own worktree
- **Sprint acceleration**: Complete sprint-level work in days instead of weeks
- **Exploratory development**: Run multiple approaches to a problem, pick the best one
- **Code review integration**: Review and approve AI-generated code before merge

---

## Market Context

### Industry Trends (2026)

- **Multi-agent systems** are surging: Gartner reports 1,445% growth in inquiries from Q1 2024 to Q2 2025
- **Git worktrees** have emerged as the standard isolation mechanism for parallel AI coding
- **MCP** is becoming "as fundamental to AI development as containers are to cloud infrastructure"
- The developer role is shifting from "lone coder" to "orchestrator of AI teams"

### Productivity Claims

Research shows mixed results:
- Heavy AI developers report saving 6-7 hours weekly
- Teams report shipping quarterly roadmaps in 3-4 weeks
- However: "10x throughput on parallelizable work" is not the same as "10x productivity"

The bottleneck is often not code generation but:
- Code review capacity
- Debugging agent conflicts
- Maintaining quality standards

---

## Recommendations

### Positioning

"**Orchard**: The dashboard for parallel AI coding"

Key messages:
1. **Visibility** - "See what all your AI agents are doing, in real time"
2. **Control** - "Review and approve before merge"
3. **Standards** - "Built on MCP, git worktrees, and modern web tech"

### Potential Improvements

Based on competitive analysis:

1. **Specialized agent roles** (like ccswarm's Frontend/Backend/QA agents)
2. **Inline code review** (like Pochi's line-level comments)
3. **Agent observability metrics** (token usage, latency, error rates)
4. **Team features** (shared dashboards, role-based access)

---

## Sources

### AI Coding Landscape
- [Best AI Coding Agents for 2026 - Faros AI](https://www.faros.ai/blog/best-ai-coding-agents-2026)
- [Ranking AI Coding Agents - Medium](https://medium.com/@mehulgupta_7991/ranking-ai-coding-agents-from-cursor-to-claude-code-dda0984b737f)
- [Coding Agents in 2026 - PeerPush](https://peerpush.net/blog/coding-agents-in-2026)
- [Claude Code Swarms Feature - byteiota](https://byteiota.com/claude-code-swarms-hidden-multi-agent-feature-discovered/)

### Git Worktrees & Parallel Development
- [Git Worktrees for AI Agents - Medium](https://medium.com/@mabd.dev/git-worktrees-the-secret-weapon-for-running-multiple-ai-coding-agents-in-parallel-e9046451eb96)
- [How We Built True Parallel Agents - DEV](https://dev.to/getpochi/how-we-built-true-parallel-agents-with-git-worktrees-2580)
- [The Rise of Coding Agent Orchestrators - Aviator](https://www.aviator.co/blog/the-rise-of-coding-agent-orchestrators/)
- [Parallel Workflows with Git Worktrees - Medium](https://medium.com/@dennis.somerville/parallel-workflows-git-worktrees-and-the-art-of-managing-multiple-ai-agents-6fa3dc5eec1d)

### Claude Code Subagents
- [Claude Code Subagents - zachwills.net](https://zachwills.net/how-to-use-claude-code-subagents-to-parallelize-development/)
- [Background Agents in Claude Code - ClaudeLog](https://claudelog.com/faqs/what-are-background-agents/)
- [Multi-Agent Orchestration - DEV](https://dev.to/bredmond1019/multi-agent-orchestration-running-10-claude-instances-in-parallel-part-3-29da)
- [Create Custom Subagents - Claude Code Docs](https://code.claude.com/docs/en/sub-agents)

### Competing Tools
- [Claude Squad - GitHub](https://github.com/smtg-ai/claude-squad)
- [ccswarm - GitHub](https://github.com/nwiizo/ccswarm)
- [claude-worktree - GitHub](https://github.com/bucket-robotics/claude-worktree)
- [Pochi Documentation](https://docs.getpochi.com/)

### MCP and Multi-Agent AI
- [Model Context Protocol - Wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol)
- [MCP & Multi-Agent AI - OneReach](https://onereach.ai/blog/mcp-multi-agent-ai-collaborative-intelligence/)
- [Building Effective AI Agents with MCP - Red Hat](https://developers.redhat.com/articles/2026/01/08/building-effective-ai-agents-mcp)
- [MCP Official Site](https://modelcontextprotocol.io/)

### Additional Research (Feb 2026)
- [AI Coding Assistants 2025: Cursor vs GitHub Copilot vs Claude Code vs Windsurf](https://usama.codes/blog/ai-coding-assistants-2025-comparison)
- [10 Things Developers Want from their Agentic IDEs in 2025](https://redmonk.com/kholterhoff/2025/12/22/10-things-developers-want-from-their-agentic-ides-in-2025/)
- [How To Use Claude Code To Wield Coding Agent Clusters](https://www.pulsemcp.com/posts/how-to-use-claude-code-to-wield-coding-agent-clusters)
- [Parallel AI Coding with Git Worktrees and Custom Claude Code Commands](https://docs.agentinterviews.com/blog/parallel-ai-coding-with-gitworktrees/)
- [Devin AI Complete Guide](https://www.digitalapplied.com/blog/devin-ai-autonomous-coding-complete-guide)
- [Devin 2.0 Explained](https://www.analyticsvidhya.com/blog/2025/04/devin-2-0/)
