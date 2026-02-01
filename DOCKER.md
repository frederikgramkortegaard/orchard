# Orchard Docker Setup

This document describes how to run Orchard using Docker.

## Quick Start

```bash
# Build and start all services
docker compose up --build

# Or run in detached mode
docker compose up --build -d
```

Once running, access the web interface at: **http://localhost:5173**

## Services

| Service | Port | Description |
|---------|------|-------------|
| `terminal-daemon` | 3002 | PTY session manager for Claude Code agents |
| `server` | 3001 | Fastify REST API & WebSocket server |
| `web` | 5173 | React frontend |

## Configuration

### Workspace Directory

By default, the `./workspace` directory is mounted into containers. To use a different directory:

```bash
# Using environment variable
WORKSPACE_PATH=/path/to/your/projects docker compose up --build

# Or create a .env file
echo "WORKSPACE_PATH=/path/to/your/projects" > .env
docker compose up --build
```

### Data Persistence

Orchard data (SQLite database, terminal sessions) is persisted in a Docker volume named `orchard-data`. This ensures your data survives container restarts.

To inspect the volume:
```bash
docker volume inspect orchard_orchard-data
```

To remove all data and start fresh:
```bash
docker compose down -v
```

## Build Targets

The Dockerfile uses multi-stage builds. You can build individual services:

```bash
# Build only the server
docker build --target server -t orchard-server .

# Build only the terminal daemon
docker build --target terminal-daemon -t orchard-terminal-daemon .

# Build only the web frontend
docker build --target web -t orchard-web .

# Build development image (all services)
docker build --target development -t orchard-dev .
```

## Development Mode

For development with hot reloading:

```bash
# Using the development target
docker build --target development -t orchard-dev .
docker run -it --rm \
  -p 3001:3001 \
  -p 3002:3002 \
  -p 5173:5173 \
  -v $(pwd):/app \
  -v /app/node_modules \
  orchard-dev
```

Or use bind mounts with docker-compose for development:

```yaml
# docker-compose.override.yml
services:
  server:
    build:
      target: development
    volumes:
      - .:/app
      - /app/node_modules
    command: pnpm dev:server
```

## Native Modules

Orchard uses native Node.js modules that require compilation:

- **node-pty**: Terminal emulation (used by terminal-daemon)
- **better-sqlite3**: SQLite database (used by server)

The Docker build automatically handles compilation using the `node:22-bookworm-slim` base image which includes necessary build tools.

## Troubleshooting

### Container fails to start

Check logs for specific service:
```bash
docker compose logs terminal-daemon
docker compose logs server
docker compose logs web
```

### Port already in use

If ports are already bound on your host:
```bash
# Use different ports
docker compose up --build \
  -e "ports=3003:3002" # for terminal-daemon
```

Or modify `docker-compose.yml` to use different host ports.

### Permission issues with mounted volumes

On Linux, you may need to ensure the mounted directory has correct permissions:
```bash
# Create workspace directory with correct ownership
mkdir -p workspace
chmod 755 workspace
```

### Health check failures

If services fail health checks, check if they're starting correctly:
```bash
# Watch logs in real-time
docker compose logs -f

# Check service status
docker compose ps
```

### Rebuild after code changes

```bash
# Rebuild and restart all services
docker compose up --build --force-recreate

# Rebuild specific service
docker compose build server
docker compose up -d server
```

## Architecture

```
                            ┌─────────────────────────────────────────────────┐
                            │              Docker Network                      │
                            │             (orchard-network)                    │
                            │                                                  │
┌────────────┐              │  ┌────────────┐      ┌──────────────────────┐   │
│            │    :5173     │  │            │      │                      │   │
│   Browser  │─────────────►│  │    web     │      │  terminal-daemon     │   │
│            │              │  │  (nginx)   │      │      :3002           │   │
└────────────┘              │  │            │      │    (WebSocket)       │   │
                            │  └──────┬─────┘      └───────────▲──────────┘   │
                            │         │                        │              │
                            │         │ /api/* ──► /           │              │
                            │         │ /ws    ──► /ws         │              │
                            │         ▼                        │              │
                            │  ┌──────────────────┐            │              │
                            │  │                  │            │              │
                            │  │     server       │────────────┘              │
                            │  │      :3001       │                           │
                            │  │ (Fastify/SQLite) │                           │
                            │  └────────┬─────────┘                           │
                            │           │                                     │
                            │           ▼                                     │
                            │  ┌─────────────────┐                            │
                            │  │    Volumes      │                            │
                            │  │  - /workspace   │                            │
                            │  │  - orchard-data │                            │
                            │  └─────────────────┘                            │
                            └─────────────────────────────────────────────────┘
```

The nginx server in the web container:
- Serves static frontend assets
- Proxies `/api/*` requests to the server (stripping `/api` prefix)
- Proxies `/ws` WebSocket connections to the server

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKSPACE_PATH` | `./workspace` | Path to mount as /workspace |
| `NODE_ENV` | `production` | Node environment |
| `PORT` | Service-specific | Port each service listens on |
| `TERMINAL_DAEMON_URL` | `ws://terminal-daemon:3002` | WebSocket URL for terminal daemon |

## Stopping Services

```bash
# Stop all services
docker compose down

# Stop and remove volumes (WARNING: deletes data)
docker compose down -v

# Stop specific service
docker compose stop server
```
