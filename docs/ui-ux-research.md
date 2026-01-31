# Multi-Agent Coding Tools: UI/UX Research

Research on interface patterns for multi-agent development tools, with focus on practical, implementable patterns.

---

## 1. Multi-Agent Display Patterns

### Cursor 2.0 Approach

Cursor's October 2025 redesign treats **agents as first-class objects**:

- **Sidebar-based agent management**: Agents, plans, and runs appear in a dedicated sidebar
- **Parallel agents**: Up to 8 agents working simultaneously, each isolated via git worktrees
- **Agent switching**: Hop between agents like switching terminals or branches
- **Background agents**: Cloud-powered agents run concurrently while you focus on other work

**Key UI Elements:**
```
┌─────────────────────────────────────────────────────┐
│  [Sidebar]           │  [Main Content]              │
│  ┌──────────────┐    │                              │
│  │ Agent 1 🟢   │    │  Conversation + Diffs        │
│  │ Agent 2 🔄   │    │                              │
│  │ Agent 3 ⏸️   │    │                              │
│  └──────────────┘    │                              │
└─────────────────────────────────────────────────────┘
```

**Implementation Pattern:**
- Agents managed as "processes" with isolated worktrees
- Each agent has its own conversation history and diff view
- Status visible at a glance in sidebar

### Windsurf/Cascade Approach

Windsurf focuses on a **single powerful agent** with multiple modes:

- **Write Mode**: Direct code changes
- **Chat Mode**: Contextual help without modifications
- **Turbo Mode**: Fully autonomous execution

**Context Awareness**: Cascade automatically tracks all actions (edits, commands, clipboard, terminal) to infer intent.

**Live Preview**: Frontend developers see UI changes directly in the editor.

---

## 2. Activity Feeds and Progress Indicators

### AG-UI Protocol Events

The [AG-UI protocol](https://docs.ag-ui.com) defines standard lifecycle events:

| Event | Purpose | UI Implication |
|-------|---------|----------------|
| `RunStarted` | Agent begins work | Show loading state |
| `StepStarted` | Subtask begins | Show step progress |
| `StepFinished` | Subtask completes | Update progress, show result |
| `RunFinished` | Success | Show completion, results |
| `RunError` | Failure | Display error, offer recovery |

### Progress Indicator Best Practices

**For Short Waits (< 3 seconds):**
- Animated spinner or pulsing icon
- Simple "Working..." text

**For Medium Waits (3-10 seconds):**
- Step-by-step progress indicator
- Show what the agent is currently doing
- Example: "Reading files... → Analyzing code... → Generating changes..."

**For Long Waits (10+ seconds):**
- Detailed progress with current step description
- Allow users to continue other work
- Notify when complete

### Streaming Responses

Always prefer streaming for AI responses:
- Shows partial results immediately
- Reduces perceived latency
- Typing indicator while generating

### Skeleton Screens

Use skeleton loaders for full UI sections:
```css
/* Shimmer animation */
.skeleton {
  background: linear-gradient(
    90deg,
    #1e293b 25%,
    #334155 50%,
    #1e293b 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

---

## 3. Terminal/Output Visualization

### Execution Path Visualization

Modern agent observability platforms use:

- **Step-by-step traces**: Show each operation as a collapsible node
- **Tool call visualization**: Display tools used, inputs, outputs
- **Error highlighting**: Clearly mark where failures occurred
- **Timing information**: Show duration of each step

### Output Display Patterns

**Collapsible Sections:**
```
▼ Agent: Analyzing codebase
  ├─ Reading src/components/*.tsx (12 files)
  ├─ Found 3 relevant components
  └─ ✓ Complete (2.3s)

▶ Agent: Generating changes (in progress...)
```

**Live Terminal Output:**
- Show real-time streaming output
- Auto-scroll with "scroll to bottom" button
- Preserve user scroll position when reviewing history
- Truncate very long output with "Show more" option

### Separating Internal Reasoning

AG-UI recommends separating:
- **Thinking steps**: Agent's internal reasoning (optional to show)
- **Actions**: What the agent is doing
- **Results**: Final output for the user

---

## 4. Agent Status Indicators

### Status States

| Status | Visual | Description |
|--------|--------|-------------|
| **Pending** | ○ Gray | Queued, waiting to start |
| **Working** | ◉ Blue + animation | Actively processing |
| **Waiting** | ◐ Yellow | Waiting for user input or dependency |
| **Blocked** | ■ Orange | Cannot proceed (error/conflict) |
| **Done** | ● Green | Successfully completed |
| **Error** | ✕ Red | Failed, needs attention |

### Visual Patterns

**Animated Working State:**
```css
.status-working {
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

**Status Badge Design:**
- Small, non-intrusive badges
- Color-coded for quick scanning
- Optional text label on hover/focus

### Agent Cards

```
┌─────────────────────────────────────┐
│ 🔄 fix-authentication               │
│ ─────────────────────────────────── │
│ Working on: Updating login flow     │
│ Progress: ████████░░ 80%            │
│ Files: 3 modified                   │
│ Duration: 45s                       │
└─────────────────────────────────────┘
```

---

## 5. Modern Design Patterns

### Design Inspiration Sources

**Linear App** - The gold standard for developer tools:
- Reduced visual noise with clear hierarchy
- LCH color space for consistent theme generation
- Three-variable theme system (base, accent, contrast)
- Dense navigation without feeling cluttered

**Raycast** - Keyboard-first launcher:
- Native macOS feel, not Electron-heavy
- High-level UI components (List, Grid, Detail, Form)
- "You concentrate on the logic, we push the pixels"
- Instant launch, minimal memory footprint

**Arc Browser** - Rethinking conventions:
- Vertical spaces instead of horizontal tabs
- Soft rounded corners and subtle animations
- Minimal chrome, content-focused

### Typography

**Principles:**
- Bold typography for headings, but not overused
- 1.5x line-height as starting point
- 8pt spacing scale with 4pt half-steps
- Sans-serif for UI, monospace for code only

**Recommended Font Stacks:**
```css
/* UI Text */
font-family: -apple-system, BlinkMacSystemFont,
  'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;

/* Monospace (code/terminal) */
font-family: 'SF Mono', 'Fira Code',
  'JetBrains Mono', Consolas, monospace;
```

**Type Scale:**
```
xs:   12px / 16px line-height
sm:   14px / 20px line-height
base: 16px / 24px line-height
lg:   18px / 28px line-height
xl:   20px / 28px line-height
2xl:  24px / 32px line-height
```

### Spacing System

Use consistent spacing based on 4px/8px grid:

```
4px  - Icon padding, tight gaps
8px  - Small gaps between related items
12px - Medium gaps
16px - Section padding
24px - Large section gaps
32px - Major section separation
```

### Subtle Animations

**Transitions to add polish:**
```css
/* Smooth state changes */
.element {
  transition: all 150ms ease-out;
}

/* Hover lift effect */
.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* Micro-interaction for buttons */
.button:active {
  transform: scale(0.98);
}
```

**Animation Timing:**
- Instant feedback: 50-100ms
- Quick transitions: 150-200ms
- Smooth movement: 200-300ms
- Complex animations: 300-500ms

### Dark Mode Color Palette

**Developer Tools Palette:**
```css
:root {
  /* Backgrounds */
  --bg-base: #0f172a;      /* Darkest - main background */
  --bg-surface: #1e293b;   /* Cards, panels */
  --bg-elevated: #334155;  /* Hover states, dropdowns */

  /* Borders */
  --border-subtle: #334155;
  --border-default: #475569;

  /* Text */
  --text-muted: #64748b;
  --text-secondary: #94a3b8;
  --text-primary: #f1f5f9;

  /* Accents */
  --accent-blue: #38bdf8;
  --accent-green: #4ade80;
  --accent-yellow: #fbbf24;
  --accent-red: #f87171;

  /* Status Colors */
  --status-pending: #64748b;
  --status-working: #38bdf8;
  --status-waiting: #fbbf24;
  --status-blocked: #fb923c;
  --status-done: #4ade80;
  --status-error: #f87171;
}
```

**Key Principles:**
- Never use pure black (#000000) - causes eye strain
- Add subtle blue tint to dark grays for warmth
- Maintain 4.5:1 contrast ratio for accessibility
- Use gradients and tonal variations for depth

### Rounded Corners

**Border Radius Scale:**
```css
--radius-sm: 4px;   /* Small elements, badges */
--radius-md: 8px;   /* Buttons, inputs */
--radius-lg: 12px;  /* Cards, panels */
--radius-xl: 16px;  /* Large containers */
--radius-full: 9999px; /* Pills, avatars */
```

**Psychological Effect:**
- Sharp corners = tension, formality
- Rounded corners = approachability, safety
- Match border-radius to typeface personality

### Shadows

**Layered Shadow System:**
```css
/* Subtle elevation */
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.1);

/* Cards, dropdowns */
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1),
             0 2px 4px -2px rgba(0, 0, 0, 0.1);

/* Modals, popovers */
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1),
             0 4px 6px -4px rgba(0, 0, 0, 0.1);

/* Floating elements */
--shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1),
             0 8px 10px -6px rgba(0, 0, 0, 0.1);
```

**Dark Mode Shadows:**
In dark mode, use lower opacity shadows or consider using:
- Lighter borders instead of shadows
- Subtle glow effects for elevation
- Background color changes for depth

---

## 6. Practical Implementation Recommendations

### Agent List Component

```tsx
interface AgentStatus {
  id: string;
  name: string;
  status: 'pending' | 'working' | 'waiting' | 'blocked' | 'done' | 'error';
  currentStep?: string;
  progress?: number;
  filesModified?: number;
  duration?: string;
}

// Visual layout
<AgentList>
  <AgentCard status="working">
    <AgentIcon animated />
    <AgentName>fix-authentication</AgentName>
    <AgentStep>Updating login flow...</AgentStep>
    <ProgressBar value={80} />
  </AgentCard>
</AgentList>
```

### Activity Feed Component

```tsx
interface ActivityEvent {
  id: string;
  agentId: string;
  type: 'step_start' | 'step_end' | 'tool_call' | 'error' | 'complete';
  title: string;
  details?: string;
  timestamp: Date;
  duration?: number;
}

// Visual layout
<ActivityFeed>
  <ActivityGroup agent="fix-authentication">
    <ActivityItem type="step_start">
      Reading configuration files
    </ActivityItem>
    <ActivityItem type="tool_call" expandable>
      <ToolCall name="read_file" args="src/config.ts" />
    </ActivityItem>
    <ActivityItem type="step_end" success>
      Configuration analyzed (1.2s)
    </ActivityItem>
  </ActivityGroup>
</ActivityFeed>
```

### Terminal Output Component

```tsx
interface TerminalOutput {
  id: string;
  agentId: string;
  content: string;
  stream: 'stdout' | 'stderr';
  timestamp: Date;
}

// Features needed:
// - Auto-scroll with scroll lock detection
// - ANSI color code parsing
// - Truncation with "Show more"
// - Copy button
// - Clear button
// - Collapsible sections for commands
```

---

## 7. Key Takeaways

1. **Agents as First-Class Objects**: Give agents prominent UI presence, not just chat messages
2. **Parallel Visibility**: Show all active agents at a glance with clear status
3. **Progressive Disclosure**: Collapse details, expand on demand
4. **Real-Time Feedback**: Stream everything, use skeletons and animations
5. **Clear Status System**: Consistent colors and icons across all status states
6. **Modern Polish**: Rounded corners, subtle animations, proper dark mode
7. **Typography Hierarchy**: Bold headings, readable body, clear spacing
8. **Accessible Colors**: 4.5:1 contrast, no pure black backgrounds

---

## Sources

### Multi-Agent Tools
- [Cursor Features](https://cursor.com/features)
- [Cursor Agents](https://cursor.com/agents)
- [Cursor 2.0 Multi-Agent Interface](https://lilys.ai/en/notes/cursor-20-20251106/cursor-new-multi-agent-interface)
- [Background Agents in Cursor](https://decoupledlogic.com/2025/05/29/background-agents-in-cursor-cloud-powered-coding-at-scale/)
- [Windsurf Cascade](https://windsurf.com/cascade)
- [Windsurf Editor](https://windsurf.com/editor)

### Progress & Status Patterns
- [AG-UI Protocol](https://docs.ag-ui.com/introduction)
- [AG-UI Events](https://docs.ag-ui.com/concepts/events)
- [AI Progress Indicators - SAP](https://www.sap.com/design-system/fiori-design-android/v25-4/in-app-ai-design/components/ai-progress-indicators)
- [Skeleton Screens - NN/g](https://www.nngroup.com/articles/skeleton-screens/)
- [Shimmer UI Tutorial](https://www.vishalgarg.io/articles/handle-loading-states-effectively-with-shimmer-ui)

### Modern Design Inspiration
- [Linear UI Redesign](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [Linear Brand Guidelines](https://linear.app/brand)
- [Linear Design Style Origins](https://medium.com/design-bootcamp/the-rise-of-linear-style-design-origins-trends-and-techniques-4fd96aab7646)
- [Raycast Developers](https://www.raycast.com/developers)
- [Raycast UI API](https://developers.raycast.com/api-reference/user-interface)
- [Arc Browser UX Analysis](https://blog.logrocket.com/ux-design/ux-analysis-arc-opera-edge/)

### Color & Typography
- [Dark Mode Color Palettes 2025](https://mypalettetool.com/blog/dark-mode-color-palettes)
- [Accessible Dark Mode Design](https://www.smashingmagazine.com/2025/04/inclusive-dark-mode-designing-accessible-dark-themes/)
- [Design Systems Typography Guide](https://www.designsystems.com/typography-guides/)
- [Beyond Rounded Corners](https://medium.muz.li/beyond-rounded-corners-strategic-use-of-border-radius-in-modern-web-interfaces-cc7ac6470498)
