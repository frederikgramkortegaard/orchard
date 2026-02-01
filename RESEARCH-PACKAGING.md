# Orchard Packaging Research

This document explores packaging options for distributing Orchard as a multi-project tool.

## Current State

Orchard is a pnpm monorepo with the following structure:
- **apps/server** - Fastify REST API (port 3001)
- **apps/web** - React 19 + Vite frontend (port 5173)
- **apps/terminal-daemon** - PTY session manager (port 3002)
- **packages/mcp-orchestrator** - MCP server for orchestrator tools
- **packages/mcp-agent** - MCP server for agent communication
- **packages/shared** - Shared TypeScript types

All packages are marked `"private": true` and require local development setup via `run.sh`.

---

## 1. npm Package Distribution

### Approach: CLI Tool via npm

The most straightforward distribution for Node.js developers is publishing a global CLI tool.

#### Recommended Structure

```
@orchard/cli           # Main CLI entry point
@orchard/server        # API server (dependency)
@orchard/web           # Bundled frontend assets
@orchard/mcp-agent     # Agent MCP server
@orchard/mcp-orchestrator  # Orchestrator MCP server
@orchard/shared        # Shared types
```

#### Key Decisions

**Global vs Local Installation:**
- Global install (`npm i -g @orchard/cli`) is appropriate for CLI tools used across projects
- Alternatively, recommend `npx @orchard/cli` for one-off usage without permanent installation
- Document global dependencies in README if required

**Module Format:**
- Export both ESM and CommonJS for broader compatibility
- Use `"type": "module"` with `exports` field for dual-format support

**Versioning Strategy:**
- Use [Changesets](https://github.com/changesets/changesets) for monorepo versioning
- Changesets generates changelogs and handles interdependent package versions
- Integrates with GitHub Actions for automated publishing

#### Implementation Steps

1. Remove `"private": true` from packages intended for publication
2. Add `"bin"` field to CLI package for executable
3. Configure Changesets: `pnpm add -Dw @changesets/cli && pnpm changeset init`
4. Add publish workflow to CI
5. Handle native dependencies (node-pty, better-sqlite3) via optional dependencies or prebuild

#### Native Module Challenges

Orchard uses native modules that require compilation:
- `node-pty` - PTY management
- `better-sqlite3` - SQLite bindings

**Solutions:**
- Use `prebuild` to ship precompiled binaries for common platforms
- Provide fallback instructions for unsupported platforms
- Consider replacing better-sqlite3 with `sql.js` (WASM) for universal compatibility

### References
- [Complete Monorepo Guide: pnpm + Changesets](https://jsdev.space/complete-monorepo-guide/)
- [Turborepo Publishing Guide](https://turborepo.dev/docs/guides/publishing-libraries)
- [NPM Package Development Best Practices](https://medium.com/@ddylanlinn/npm-package-development-guide-build-publish-and-best-practices-674714b7aef1)

---

## 2. Electron App Packaging

### Why Electron?

Electron provides a self-contained desktop application that:
- Bundles Node.js runtime (no user installation required)
- Includes the web UI in a native window
- Handles system tray integration
- Supports native file dialogs and OS integration
- Enables auto-updates

### Recommended Tools

**Electron Forge (Recommended):**
An all-in-one tool that handles packaging and distribution, combining `@electron/packager`, `@electron/osx-sign`, and installer generators.

```bash
npm init electron-app@latest orchard-desktop -- --template=webpack-typescript
```

**Electron Builder (Alternative):**
More configuration options, built-in publishing to GitHub/S3/etc.

### Architecture Considerations

```
orchard-desktop/
├── src/
│   ├── main/           # Main process (Node.js)
│   │   ├── index.ts    # App entry, window management
│   │   ├── server.ts   # Embedded Fastify server
│   │   └── pty.ts      # PTY management
│   └── renderer/       # Renderer process (Chromium)
│       └── (existing web app)
├── forge.config.ts
└── package.json
```

**Key Changes:**
1. Embed the Fastify server in the main process
2. Bundle the web app as renderer content
3. Use IPC for main↔renderer communication
4. Replace WebSocket with Electron IPC where possible

### Code Signing Requirements

| Platform | Requirement | Cost |
|----------|-------------|------|
| **macOS** | Apple Developer Program + Notarization | $99/year |
| **Windows** | EV Code Signing Certificate | $200-500/year |
| **Linux** | Not required | Free |

**macOS Notarization (Required since Catalina):**
1. Code sign with Developer ID certificate
2. Submit to Apple's notarization service
3. Staple the notarization ticket to the app

**Windows:**
- Use `@electron/windows-sign` with a certificate from DigiCert, Sectigo, or GlobalSign
- Without signing, users see SmartScreen warnings

### Auto-Update Implementation

**Using electron-updater:**
```typescript
import { autoUpdater } from 'electron-updater';

autoUpdater.checkForUpdatesAndNotify();

autoUpdater.on('update-available', () => {
  // Notify user
});

autoUpdater.on('update-downloaded', () => {
  autoUpdater.quitAndInstall();
});
```

**Update Server Options:**
- **GitHub Releases** - Free, automatic with electron-updater
- **Hazel** - Free on Vercel, pulls from GitHub Releases
- **Nuts** - Self-hosted, supports private repos
- **S3/Static hosting** - Manual setup with `update.electronjs.org`

**Platform-Specific Notes:**
- macOS: Requires `zip` target alongside `dmg` for Squirrel.Mac
- Windows: Don't check for updates on first run (--squirrel-firstrun)
- Linux: AppImage, DEB, and RPM supported

### Distribution Formats

| Platform | Recommended Format | Auto-Update |
|----------|-------------------|-------------|
| macOS | DMG + ZIP | Yes (Squirrel.Mac) |
| Windows | NSIS installer | Yes (electron-updater) |
| Linux | AppImage | Yes |
| Linux (Debian) | DEB | No (use apt repo) |

### References
- [Electron Packaging Tutorial](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging)
- [Code Signing Guide](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [electron-updater Documentation](https://www.electron.build/auto-update.html)
- [Electron Forge Code Signing](https://www.electronforge.io/guides/code-signing)

---

## 3. VS Code Extension

### Architecture Options

**Option A: Webview-based UI (Recommended)**
Embed the existing React UI in a VS Code webview panel.

```
orchard-vscode/
├── src/
│   ├── extension.ts      # Extension entry point
│   ├── OrchardPanel.ts   # Webview panel provider
│   └── server/           # Embedded or spawned server
├── webview/              # React app (bundled separately)
└── package.json
```

**Option B: Native VS Code UI**
Rebuild the UI using VS Code's TreeView, QuickPick, and other native APIs.
- More integrated feel but significant development effort
- Limited compared to custom webview UI

### Webview Implementation

**Message Passing:**
The webview runs in an isolated iframe and communicates via `postMessage`:

```typescript
// Extension side
panel.webview.postMessage({ type: 'worktree-update', data });

// Webview side
window.addEventListener('message', event => {
  const message = event.data;
  // Handle message
});
```

**Security (CSP):**
```typescript
const csp = `
  default-src 'none';
  style-src ${webview.cspSource};
  script-src ${webview.cspSource};
  font-src ${webview.cspSource};
`;
```

**Recommended Starter:**
[GitHub Next VS Code React Webviews](https://github.com/githubnext/vscode-react-webviews) provides:
- TypeScript setup for extension + webview
- VS Code theme colors as Tailwind colors
- Vite for fast building

### Server Integration

**Option 1: Spawn External Process**
```typescript
const serverProcess = spawn('node', [serverPath], {
  env: { PORT: '3001' }
});
```

**Option 2: Embedded Server**
Import Fastify directly into the extension's Node.js context.

**Option 3: Language Server Protocol (LSP)**
For complex scenarios, implement as an LSP server for better lifecycle management.

### Publishing

**Prerequisites:**
1. Azure DevOps account for Personal Access Token (PAT)
2. Publisher account on VS Code Marketplace
3. Valid `package.json` with publisher field

**Publishing to Multiple Registries:**
- **VS Code Marketplace** - Primary, for VS Code users
- **Open VSX Registry** - For VS Code forks (VSCodium, Gitpod, Cursor)

**CI/CD with GitHub Actions:**
```yaml
- uses: HaaLeo/publish-vscode-extension@v2
  with:
    pat: ${{ secrets.VSCE_PAT }}
    registryUrl: https://marketplace.visualstudio.com
```

### Bundling Considerations

- Use esbuild or webpack to bundle extension code
- Keep webview bundle separate
- Externalize `vscode` module
- Handle native modules (may need to spawn separate process)

### References
- [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [VS Code Extension with React + TypeScript](https://dev.to/rakshit47/create-vs-code-extension-with-react-typescript-tailwind-1ba6)
- [GitHub Next React Webview Toolkit](https://githubnext.com/projects/react-webview-ui-toolkit/)

---

## 4. Sandboxing Considerations for AI Agents

### The Security Challenge

Orchard spawns AI agents that can execute arbitrary code. Without proper sandboxing:
- Agents could access sensitive files outside the project
- Malicious or buggy code could damage the host system
- Network access could leak credentials or data

### Sandboxing Approaches

#### Level 1: Process Isolation (Minimal)

Current approach - agents run as separate Node.js processes with no additional isolation.

**Risks:**
- Full filesystem access
- Network access
- Can affect other processes

#### Level 2: Container Isolation (Recommended)

Run each agent in a Docker container with restricted capabilities.

**Implementation:**
```typescript
const container = await docker.createContainer({
  Image: 'orchard-agent:latest',
  HostConfig: {
    Memory: 2 * 1024 * 1024 * 1024, // 2GB
    CpuShares: 512,
    NetworkMode: 'none', // or restricted
    ReadonlyRootfs: true,
    CapDrop: ['ALL'],
    SecurityOpt: ['no-new-privileges'],
    Binds: [
      `${projectPath}:/workspace:rw`
    ]
  }
});
```

**Benefits:**
- Filesystem isolation (only mount project directory)
- Resource limits (CPU, memory)
- Network restrictions
- Reduced capabilities

**Challenges:**
- Requires Docker installation
- Startup latency (~1-2 seconds)
- Git operations need careful handling

#### Level 3: MicroVM Isolation (Maximum Security)

Use Firecracker microVMs or similar for hardware-level isolation.

**Available Solutions:**

| Solution | Type | Startup Time | Security Level |
|----------|------|--------------|----------------|
| [Daytona](https://www.daytona.io/) | Docker + Kata | <90ms | High |
| [E2B](https://e2b.dev/) | Firecracker microVMs | ~500ms | Very High |
| [Microsandbox](https://github.com/nicholaspark09/microsandbox) | libkrun microVMs | <200ms | Very High |
| Docker | Containers | ~1-2s | Medium |

**E2B Example:**
```typescript
import { Sandbox } from '@e2b/code-interpreter';

const sandbox = await Sandbox.create();
await sandbox.runCode('python', code);
await sandbox.close();
```

#### Level 4: Kubernetes Agent Sandbox

For production deployments, use the new [Agent Sandbox for Kubernetes](https://agent-sandbox.sigs.k8s.io/):
- gVisor for kernel isolation
- Pre-warmed sandbox pools for sub-second startup
- Declarative API for managing agent workloads

### Recommended Approach for Orchard

**Development Mode:**
- Container isolation via Docker (optional, user-enabled)
- Warn users about security implications

**Production/Enterprise:**
- Mandatory container isolation
- Consider E2B or Daytona for cloud deployments
- Pre-warmed container pools for low latency

### Implementation Considerations

1. **Git worktrees in containers:**
   Mount the worktree directory, not the entire repo (avoids exposing other worktrees)

2. **MCP communication:**
   Use Unix sockets or localhost networking between container and host

3. **Credential handling:**
   Never mount `.git/config` or SSH keys directly; use credential helpers

4. **Resource limits:**
   Set sensible defaults with user-configurable overrides

### Security Checklist

- [ ] Agents cannot access files outside project directory
- [ ] Network access is logged or restricted
- [ ] Resource consumption is limited (CPU, memory, disk)
- [ ] Agents cannot spawn privileged processes
- [ ] Sensitive environment variables are not exposed
- [ ] Container images are regularly updated

### References
- [Agent Sandbox for Kubernetes](https://agent-sandbox.sigs.k8s.io/)
- [Docker Sandboxes for Coding Agent Safety](https://www.docker.com/blog/docker-sandboxes-a-new-approach-for-coding-agent-safety/)
- [Complete Guide to Sandboxing Autonomous Agents](https://www.ikangai.com/the-complete-guide-to-sandboxing-autonomous-agents-tools-frameworks-and-safety-essentials/)
- [Awesome Sandbox - Code Sandboxing for AI](https://github.com/restyler/awesome-sandbox)

---

## 5. Installation Workflows

### Workflow A: npm Global Install (Developers)

```bash
# One-time installation
npm install -g @orchard/cli

# Usage
orchard init          # Initialize in current project
orchard start         # Start the orchestrator
orchard agent create  # Create a new agent
```

**Pros:**
- Familiar to Node.js developers
- Easy updates via `npm update -g`
- No additional runtime required

**Cons:**
- Requires Node.js 20+
- Native module compilation may fail
- Version conflicts between projects

### Workflow B: npx (Zero Install)

```bash
# No installation required
npx @orchard/cli start
```

**Pros:**
- Always runs latest version
- No global installation
- No version conflicts

**Cons:**
- Slower startup (downloads each time unless cached)
- Still requires Node.js

### Workflow C: Standalone Binary (corepack/pkg)

Bundle Node.js runtime into a single executable.

```bash
# Download and run
curl -fsSL https://orchard.dev/install.sh | sh
orchard start
```

**Tools:**
- [pkg](https://github.com/vercel/pkg) - Bundle into single executable
- [nexe](https://github.com/nexe/nexe) - Alternative bundler
- [Bun compile](https://bun.sh/docs/bundler/executables) - If migrating to Bun

**Pros:**
- No Node.js required
- Single file distribution
- Consistent runtime

**Cons:**
- Large binary size (~50-100MB)
- Native modules require special handling
- Platform-specific binaries needed

### Workflow D: Electron App (Non-Developers)

```
1. Download .dmg / .exe / .AppImage from website
2. Install and launch
3. Open project folder
4. Start orchestrating
```

**Pros:**
- No command line required
- Native desktop experience
- Auto-updates

**Cons:**
- Larger download (~150-200MB)
- More complex to maintain

### Workflow E: VS Code Extension (IDE Users)

```
1. Open VS Code Extensions
2. Search "Orchard"
3. Click Install
4. Open Command Palette: "Orchard: Start"
```

**Pros:**
- Integrated into existing workflow
- Leverages VS Code's update mechanism
- Access to editor APIs

**Cons:**
- Limited to VS Code users
- Webview constraints

### Workflow F: Docker (DevOps/Enterprise)

```bash
docker run -v $(pwd):/workspace -p 5173:5173 orchard/orchard
```

**Pros:**
- Consistent environment
- Easy CI/CD integration
- Sandboxing built-in

**Cons:**
- Requires Docker
- PTY in containers can be tricky
- Git authentication complexity

### Recommended Distribution Matrix

| Target Audience | Primary | Secondary |
|-----------------|---------|-----------|
| Node.js developers | npm CLI | Docker |
| General developers | Electron app | VS Code extension |
| Enterprise/DevOps | Docker | Kubernetes Helm chart |
| VS Code users | VS Code extension | npm CLI |

### First-Run Experience

Regardless of installation method, the first-run should:

1. **Detect project** - Find .git root, package.json, etc.
2. **Configure MCP** - Auto-generate or update `.mcp.json`
3. **Check prerequisites** - Verify Claude CLI availability
4. **Create sample agent** - Optional "hello world" agent to demonstrate functionality

---

## Summary & Recommendations

### Phase 1: npm CLI (Immediate)

1. Prepare packages for publishing
2. Set up Changesets for versioning
3. Handle native modules with prebuilds
4. Create `@orchard/cli` as the main entry point

**Estimated effort:** Medium

### Phase 2: Electron App (Short-term)

1. Create Electron wrapper with Forge
2. Embed server in main process
3. Implement code signing for macOS/Windows
4. Set up auto-update infrastructure

**Estimated effort:** High

### Phase 3: VS Code Extension (Medium-term)

1. Create extension scaffold with webview
2. Port React UI to webview context
3. Implement message passing
4. Publish to Marketplace and Open VSX

**Estimated effort:** High

### Phase 4: Sandboxing (Ongoing)

1. Add optional Docker isolation
2. Integrate with cloud sandbox providers (E2B)
3. Document security best practices

**Estimated effort:** Medium-High

### Key Decisions Needed

1. **Primary distribution target** - npm CLI vs Electron app?
2. **Code signing investment** - Worth the annual cost?
3. **Sandboxing requirement** - Optional or mandatory?
4. **Open source licensing** - MIT, Apache 2.0, or proprietary?

---

*Last updated: 2026-02-01*
