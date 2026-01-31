#!/bin/bash

# Orchard Development Runner
# This script starts the terminal daemon, server, and web frontend with hot reloading

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting Orchard Development Environment${NC}"
echo ""

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo -e "${RED}Error: pnpm is not installed${NC}"
    echo "Install it with: npm install -g pnpm"
    exit 1
fi

# Navigate to project root
cd "$(dirname "$0")"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    pnpm install
fi

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Shutting down...${NC}"
    # Kill processes by port
    lsof -ti:3001 | xargs kill -9 2>/dev/null || true
    lsof -ti:3002 | xargs kill -9 2>/dev/null || true
    lsof -ti:5173 | xargs kill -9 2>/dev/null || true
    # Kill background jobs
    jobs -p | xargs kill 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM

# Kill existing processes on ports
echo -e "${YELLOW}Cleaning up existing processes...${NC}"
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
lsof -ti:3002 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 1

echo -e "${GREEN}Starting services...${NC}"
echo ""

# Start terminal daemon first (it must be running before the server)
echo -e "  ${BLUE}Terminal Daemon:${NC}  ws://localhost:3002"
pnpm --filter @orchard/terminal-daemon dev &
DAEMON_PID=$!

# Wait for daemon to start
sleep 2

# Start main server
echo -e "  ${BLUE}Server:${NC}          http://localhost:3001"
pnpm --filter @orchard/server dev &
SERVER_PID=$!

# Wait for server to start
sleep 2

# Start web frontend
echo -e "  ${BLUE}Web:${NC}             http://localhost:5173"
pnpm --filter @orchard/web dev &
WEB_PID=$!

echo ""
echo -e "${GREEN}All services started!${NC}"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# Wait for any process to exit
wait
