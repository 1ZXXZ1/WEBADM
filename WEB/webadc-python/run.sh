#!/bin/bash
#
# WebADC Python — Quick Start
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  WebADC — Python FastAPI Server"
echo "═══════════════════════════════════════════════════════"
echo ""

# 1. Install dependencies
echo "[1/2] Installing Python dependencies..."
pip install -r requirements.txt -q

# 2. Run
echo "[2/2] Starting server..."
echo ""
python3 main.py
