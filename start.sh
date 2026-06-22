#!/bin/bash
# AutoStep - Start script
# Usage: ./start.sh [dev|prod]

MODE=${1:-dev}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$MODE" = "prod" ]; then
  echo "Building frontend..."
  cd "$ROOT/frontend" && npm run build
  echo "Starting backend (serves frontend on :3001)..."
  cd "$ROOT/backend" && npx tsx src/index.ts
else
  echo "Starting AutoStep in development mode..."
  echo "  Backend:  http://localhost:3001"
  echo "  Frontend: http://localhost:5173"
  echo ""
  # Start backend
  cd "$ROOT/backend" && npx tsx src/index.ts &
  BACKEND_PID=$!
  # Start frontend
  cd "$ROOT/frontend" && npm run dev &
  FRONTEND_PID=$!
  echo "Press Ctrl+C to stop both servers"
  trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
  wait
fi
