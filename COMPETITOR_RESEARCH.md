# Orchard: Project Definition & Competitor Research

## What is Orchard?

**Orchard** is a web-based multi-agent orchestrator for Claude Code that enables developers to run multiple AI coding agents in parallel on different features simultaneously. It coordinates these agents using git worktrees for isolation and provides a real-time web dashboard for monitoring, managing, and reviewing their work.

### Core Value Proposition

"Run multiple AI coding agents in parallel on your codebase, each working on its own feature branch, with a dashboard to monitor progress and merge their work."

### Problems Orchard Solves

1. **Parallelization** - Traditional AI coding assistants work on one feature at a time. Orchard enables true parallel development where multiple features can be implemented simultaneously.

2. **Observability** - When multiple agents work in parallel, it's difficult to track what each is doing. Orchard's dashboard provides real-time visibility into all agent activities.

3. **Code Quality Control** - AI-generated code needs human review before merging. Orchard provides a diff viewer and code review interface.

4. **Debugging Conflicts** - Orchard logs all activities (file edits, commits, progress updates, errors) in a unified feed.

5. **Agent Coordination** - Bidirectional communication via Model Context Protocol (MCP) enables agents to report status, ask questions, and receive guidance.

### Key Features

- **Worktree Management**: Isolated git worktrees for each agent task with automatic branch creation and merge capabilities
- **Agent Monitoring**: Real-time terminal output streaming via WebSocket with status indicators (WORKING, IDLE, BLOCKED, DEAD)
- **Activity Log**: Unified feed of all agent activities with structured activity types
- **Diff Viewer**: Side-by-side code comparison with Monaco Editor for visual code review
- **MCP Integration**: Two MCP servers enable bidirectional orchestrator-agent communication
- **Plan Mode**: Agents can propose implementation plans before executing for human-in-the-loop approval
- **Orchestrator Loop**: Autonomous LLM-based coordination that can respond to agent questions automatically
- **Session Persistence**: Resume Claude Code sessions after interruption

### Technology Stack

**Frontend**: React 19, TypeScript, Vite, TailwindCSS 4.0, Monaco Editor, xterm.js, Zustand

**Backend**: Fastify 5, TypeScript, SQLite (better-sqlite3), WebSocket, node-pty, simple-git, OpenAI SDK

**Architecture**: Monorepo with pnpm workspaces, MCP servers for agent communication

### Target Audience

- Individual developers running multiple features in parallel
- Small teams needing shared visibility into AI-assisted development
- AI-first development shops scaling beyond single-agent workflows

---

## Competitor Analysis

### Direct Competitors (Multi-Agent Orchestration)

#### 1. Claude Squad
**URL**: https://github.com/smtg-ai/claude-squad

A terminal app that manages multiple Claude Code, Codex, Gemini, and local agents (including Aider) in separate workspaces.

**Key Features**:
- Uses tmux to create isolated terminal sessions for each agent
- Uses git worktrees to isolate codebases so each session works on its own branch
- Complete tasks in background with yolo/auto-accept mode
- Install via `brew install claude-squad` or curl script

**Orchard Differentiation**: Orchard offers a web-based dashboard vs Claude Squad's terminal-only interface. Orchard provides activity logging, diff viewing, and LLM-based orchestration that Claude Squad lacks.

---

#### 2. Claude-Flow
**URL**: https://github.com/ruvnet/claude-flow

Described as "the leading agent orchestration platform for Claude" with enterprise-grade architecture.

**Key Features**:
- Deploy intelligent multi-agent swarms
- Coordinate autonomous workflows
- Distributed swarm intelligence
- RAG integration
- Native Claude Code support via MCP protocol
- Self-learning neural capabilities

**Orchard Differentiation**: Orchard focuses on practical web-based orchestration with visual diff review and activity logging, while Claude-Flow emphasizes enterprise architecture and swarm intelligence.

---

#### 3. Oh My Claude Code (OMC)
**URL**: https://github.com/Yeachan-Heo/oh-my-claudecode

Multi-agent orchestration for Claude Code with 5 execution modes.

**Key Features**:
- Autopilot (autonomous)
- Ultrapilot (3-5x parallel)
- Swarm (coordinated agents)
- Pipeline (sequential chains)
- Ecomode (token-efficient)
- 31+ skills and 32 specialized agents

**Orchard Differentiation**: OMC focuses on execution modes and specialized agents, while Orchard provides a visual dashboard for monitoring and code review.

---

#### 4. DevSwarm
**URL**: https://devswarm.ai

An AI Development Environment (ADE) for parallel coding with multiple AI assistants.

**Key Features**:
- Run Claude Code, Codex, Gemini, Amazon Q, or local agents side by side
- Each assistant works on its own Git branch
- Up to 10 parallel agents in free developer edition
- "Hivecoding" practice for multi-agent orchestration
- Native integrations with Jira and GitHub (paid)

**Orchard Differentiation**: DevSwarm is a standalone IDE augmentation platform, while Orchard is specifically focused on Claude Code orchestration with MCP integration and web dashboard.

---

#### 5. Aider Multi-Coder
**URL**: https://playbooks.com/mcp/eiliyaabedini-aider

MCP server providing a bridge between Aider and AI models.

**Key Features**:
- Parallel execution of multiple coding tasks
- Configurable file access permissions
- Comprehensive error handling

**Orchard Differentiation**: Orchard provides a complete orchestration solution with UI, while Aider Multi-Coder is an MCP bridge tool.

---

### Agentic IDEs (Indirect Competitors)

#### 6. Cursor 2.0
**URL**: https://cursor.com

AI-native IDE built on VS Code with parallel agent capabilities.

**Key Features**:
- Run up to 8 agents in parallel on a single prompt
- Uses git worktrees or remote machines to prevent file conflicts
- Background Agents run in isolated Ubuntu-based VMs with internet access
- Agent-centric interface with dedicated sidebar
- Composer: their own ultra-fast coding model

**Pricing**: Pro tier + usage-based spending (minimum $10-20 to fund account)

**Orchard Differentiation**: Cursor is a full IDE with proprietary infrastructure, while Orchard is tool-agnostic and works with Claude Code in any terminal. Cursor requires paid cloud resources; Orchard runs locally.

---

#### 7. Windsurf Editor
**URL**: https://windsurf.com

Agentic IDE by Codeium designed for enterprise teams and large codebases.

**Key Features**:
- Cascade system that auto-iterates until code works
- Hybrid indexing with AST parsing and semantic embeddings
- Persistent "Memories" for style and patterns
- Native JetBrains integration
- SWE-1.5 native model for low-latency orchestration

**Pricing**: Free tier available, $15/month Pro

**Orchard Differentiation**: Windsurf is a full IDE with focus on enterprise and large codebases. Orchard is lightweight and focused specifically on multi-agent orchestration.

---

### Autonomous AI Engineers

#### 8. Devin AI
**URL**: https://devin.ai

World's first fully autonomous AI software engineer by Cognition Labs.

**Key Features**:
- Autonomous planning, coding, debugging, and deployment
- Shell, code editor, and browser in sandboxed environment
- Multi-agent operation capability
- Self-assessed confidence evaluation
- Devin Wiki and Devin Search features
- Enterprise deployments (Goldman Sachs, Nubank)

**Orchard Differentiation**: Devin is a fully autonomous closed-source SaaS product for enterprise. Orchard is open-source and gives humans control via approval workflows.

---

#### 9. OpenHands (formerly OpenDevin)
**URL**: https://openhands.dev | https://github.com/OpenHands/OpenHands

Open-source AI software engineer (65K+ GitHub stars).

**Key Features**:
- Solves 50%+ of real GitHub issues in benchmarks
- SDK, CLI, and cloud platform options
- Powers agents with Claude, GPT, or any LLM
- Native integrations with GitHub, GitLab, CI/CD, Slack
- $18.8M funding, MIT-licensed

**Orchard Differentiation**: OpenHands focuses on autonomous issue resolution; Orchard focuses on orchestrating parallel development with human oversight.

---

### IDE Extensions

#### 10. GitHub Copilot (with Workspace & Coding Agent)
**URL**: https://github.com/features/copilot

GitHub's AI pair programmer evolving into multi-agent ecosystem.

**Key Features**:
- Copilot Workspace for task-oriented development with sub-agents
- Copilot CLI with Explore, Task, and Code-review agents
- Coding Agent runs in background with GitHub Actions
- Agentic memory system (January 2026)
- Agent Skills: folders of instructions for specialized tasks

**Orchard Differentiation**: Copilot is tightly integrated with GitHub ecosystem. Orchard is platform-agnostic and provides dedicated visual orchestration.

---

#### 11. Pochi
**URL**: https://docs.getpochi.com

Open-source AI coding agent as VS Code extension.

**Key Features**:
- Use any LLM provider via API keys
- Cloud-based services available with account
- Hierarchical configuration (global and workspace)
- Described as "Full-Stack AI Teammate"

**Orchard Differentiation**: Pochi is a VS Code extension for single-agent use. Orchard provides multi-agent orchestration with web dashboard.

---

#### 12. Kilo Code
**URL**: https://kilo.ai

AI coding agent for VS Code and JetBrains IDEs.

**Key Features**:
- Cross-IDE support
- AI agent capabilities

**Orchard Differentiation**: IDE-locked agent vs Orchard's standalone web-based orchestration platform.

---

### Multi-Agent Frameworks

#### 13. CC Mirror
Open-source agent coordination using Claude Code's native Task tool.

**Key Features**:
- No extra dependencies
- Pure task decomposition with blocking relationships
- Background execution with dependency graphs
- "The Conductor" pattern

**Orchard Differentiation**: CC Mirror is a lightweight coordination pattern; Orchard provides full infrastructure with persistence, UI, and MCP integration.

---

#### 14. Agent Base
**URL**: https://github.com/AgentOrchestrator/AgentBase

Multi-agent orchestrator for tracking and analyzing AI coding assistant conversations.

**Key Features**:
- Visual canvas to launch and manage multiple agents
- Shared context but isolated edits
- Support for Claude Code, Cursor, Windsurf

**Orchard Differentiation**: Agent Base focuses on conversation tracking across tools; Orchard focuses on active orchestration of Claude Code agents.

---

## Competitive Positioning

### Orchard's Unique Value

| Feature | Orchard | Claude Squad | Cursor | Windsurf | DevSwarm |
|---------|---------|--------------|--------|----------|----------|
| Web Dashboard | ✅ | ❌ | ❌ | ❌ | ❌ |
| Git Worktree Isolation | ✅ | ✅ | ✅ | ❌ | ✅ |
| MCP Integration | ✅ | ❌ | ❌ | ❌ | ❌ |
| Activity Logging | ✅ | ❌ | Partial | Partial | ❌ |
| Diff Viewer | ✅ | ❌ | ✅ | ✅ | ❌ |
| Plan Mode Approval | ✅ | ❌ | ✅ | Partial | ❌ |
| Open Source | ✅ | ✅ | ❌ | ❌ | Partial |
| Free/Local | ✅ | ✅ | ❌ | Partial | Partial |
| Claude Code Focus | ✅ | ✅ | ❌ | ❌ | Partial |

### Key Differentiators

1. **Web-based Dashboard**: Unlike terminal-only competitors (Claude Squad, cwt), Orchard provides browser-accessible monitoring and management.

2. **Bidirectional MCP Integration**: Two MCP servers enable true bidirectional communication between orchestrator and agents, following emerging MCP standards.

3. **Unified Activity Feed**: Aggregates all agent activities in one view, reducing the "detective work" of debugging parallel agents.

4. **Visual Code Review**: Monaco Editor-powered diff viewer for quality control of AI-generated code.

5. **Open Source + Local**: Unlike Cursor/Devin which require cloud infrastructure and payments, Orchard runs entirely locally.

6. **Claude Code Specialization**: Purpose-built for Claude Code workflows with native terminal integration.

### Market Opportunity

The multi-agent orchestration market is rapidly growing as developers seek to parallelize AI-assisted development:

- 65% of developers now use AI coding tools at least weekly (Stack Overflow 2025)
- Early studies show 20-55% faster task completion with AI tools
- The market is shifting from single-agent "Copilots" to multi-agent "Agentic IDEs"
- Key trend: tools that provide observability, quality control, and human-in-the-loop workflows

### Potential Threats

1. **Cursor 2.0**: Well-funded, polished IDE with up to 8 parallel agents. May capture market before standalone tools gain traction.

2. **GitHub Copilot**: Tight GitHub integration and enterprise adoption could make it the default for many teams.

3. **Devin AI**: Enterprise adoption (Goldman Sachs) may set expectations for fully autonomous agents rather than orchestrated workflows.

4. **DevSwarm**: Direct competitor with similar philosophy (parallel agents, git worktrees) and established product.

---

## Recommendations

1. **Emphasize Web Dashboard**: This is Orchard's strongest differentiator vs terminal-based competitors.

2. **MCP Ecosystem**: Position as the MCP-native orchestrator as the protocol gains adoption.

3. **Enterprise Features**: Consider team collaboration, shared dashboards, and integration with ticketing systems.

4. **Documentation**: Create comparison guides showing Orchard vs Claude Squad, Cursor, etc.

5. **Hybrid Approach**: Consider CLI tools alongside web dashboard for maximum flexibility.

---

*Research conducted: February 2026*
