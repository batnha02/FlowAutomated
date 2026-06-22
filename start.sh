#!/bin/bash
# AutoStep — Python edition
# Usage: ./start.sh [--port 8000]

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${2:-8000}"

cd "$ROOT"

# Create venv if needed
if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
fi

# Install / update packages
echo "Checking dependencies..."
venv/bin/pip install -q -r requirements.txt

echo ""
echo "  AutoStep running on http://localhost:${PORT}"
echo "  Default login: admin / 123456"
echo ""

venv/bin/python run_server.py --port "$PORT" --reload
