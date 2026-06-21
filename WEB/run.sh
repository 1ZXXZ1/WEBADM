#!/bin/bash
#
# Samba AD Panel — Local Run Script
# Auto-installs dependencies and starts the development server
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Samba AD Panel — Local Development Server        ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo ""

# 1. Check Node.js
echo -e "${YELLOW}[1/4]${NC} Checking environment..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}ERROR: Node.js is not installed!${NC}"
    echo "Please install Node.js v18+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}ERROR: Node.js v18+ required, found v$(node -v)${NC}"
    exit 1
fi
echo -e "  Node.js: $(node -v) ${GREEN}OK${NC}"

# Check for npm, bun, or yarn
if command -v bun &> /dev/null; then
    PKG_MANAGER="bun"
    echo -e "  Package manager: bun ${GREEN}OK${NC}"
elif command -v npm &> /dev/null; then
    PKG_MANAGER="npm"
    echo -e "  Package manager: npm ${GREEN}OK${NC}"
else
    echo -e "${RED}ERROR: No package manager found (npm or bun)${NC}"
    exit 1
fi

# 2. Install dependencies
echo ""
echo -e "${YELLOW}[2/4]${NC} Installing dependencies..."
if [ "$PKG_MANAGER" = "bun" ]; then
    bun install --frozen-lockfile 2>/dev/null || bun install
else
    npm ci --prefer-offline 2>/dev/null || npm install
fi
echo -e "  Dependencies installed ${GREEN}OK${NC}"

# 3. Generate Prisma client (if DATABASE_URL is set)
echo ""
echo -e "${YELLOW}[3/4]${NC} Checking database..."
if [ -n "$DATABASE_URL" ]; then
    echo -e "  DATABASE_URL is set — generating Prisma client..."
    if [ "$PKG_MANAGER" = "bun" ]; then
        bunx prisma generate 2>/dev/null || true
    else
        npx prisma generate 2>/dev/null || true
    fi
    echo -e "  Prisma client generated ${GREEN}OK${NC}"
else
    echo -e "  DATABASE_URL not set — skipping Prisma (use Local Demo mode in browser) ${YELLOW}SKIP${NC}"
fi

# 4. Start the dev server
echo ""
echo -e "${YELLOW}[4/4]${NC} Starting development server..."
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Server will start at: http://localhost:3000      ${NC}"
echo -e "${GREEN}  Login page → click \"Local\" tab → \"Start Local Demo\" ${NC}"
echo -e "${GREEN}  Press Ctrl+C to stop                              ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""

if [ "$PKG_MANAGER" = "bun" ]; then
    bun run dev
else
    npm run dev
fi
