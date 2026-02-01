# Orchard Monorepo Dockerfile
# Multi-stage build for efficient image creation

# ==============================================================================
# Stage 1: Base image with build dependencies
# ==============================================================================
FROM node:22-bookworm-slim AS base

# Install build tools for native modules (node-pty, better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# ==============================================================================
# Stage 2: Install dependencies
# ==============================================================================
FROM base AS deps

# Copy workspace configuration files
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY tsconfig.base.json ./

# Copy all package.json files to maintain workspace structure
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/terminal-daemon/package.json ./apps/terminal-daemon/
COPY packages/shared/package.json ./packages/shared/
COPY packages/mcp-agent/package.json ./packages/mcp-agent/
COPY packages/mcp-orchestrator/package.json ./packages/mcp-orchestrator/

# Install dependencies (including native modules)
RUN pnpm install --frozen-lockfile

# ==============================================================================
# Stage 3: Build all packages
# ==============================================================================
FROM deps AS builder

# Copy source code
COPY apps ./apps
COPY packages ./packages

# Build all packages
RUN pnpm build

# ==============================================================================
# Stage 4: Production runtime for terminal-daemon
# ==============================================================================
FROM node:22-bookworm-slim AS terminal-daemon

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    git \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace configuration
COPY --from=deps /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json ./
COPY --from=deps /app/apps/terminal-daemon/package.json ./apps/terminal-daemon/
COPY --from=deps /app/packages/shared/package.json ./packages/shared/
COPY --from=deps /app/packages/mcp-agent/package.json ./packages/mcp-agent/

# Copy node_modules with native bindings
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/terminal-daemon/node_modules ./apps/terminal-daemon/node_modules

# Copy built code
COPY --from=builder /app/apps/terminal-daemon/dist ./apps/terminal-daemon/dist
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/mcp-agent/dist ./packages/mcp-agent/dist

ENV NODE_ENV=production
ENV PORT=3002

EXPOSE 3002

CMD ["node", "apps/terminal-daemon/dist/index.js"]

# ==============================================================================
# Stage 5: Production runtime for server
# ==============================================================================
FROM node:22-bookworm-slim AS server

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    git \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace configuration
COPY --from=deps /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json ./
COPY --from=deps /app/apps/server/package.json ./apps/server/
COPY --from=deps /app/packages/shared/package.json ./packages/shared/
COPY --from=deps /app/packages/mcp-orchestrator/package.json ./packages/mcp-orchestrator/

# Copy node_modules with native bindings (better-sqlite3)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules

# Copy built code
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/mcp-orchestrator/dist ./packages/mcp-orchestrator/dist

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "apps/server/dist/index.js"]

# ==============================================================================
# Stage 6: Production runtime for web frontend (nginx)
# ==============================================================================
FROM nginx:alpine AS web

# Copy built frontend assets
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]

# ==============================================================================
# Stage 7: Development image (all services)
# ==============================================================================
FROM base AS development

WORKDIR /app

# Copy everything for development
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Install dependencies to ensure all workspace links are correct
RUN pnpm install

ENV NODE_ENV=development

EXPOSE 3001 3002 5173

# Default command runs all services
CMD ["pnpm", "dev"]
