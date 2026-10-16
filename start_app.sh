#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Iniciando Backend FastAPI (Porta 8000)..."
"$ROOT_DIR/.venv/bin/uvicorn" main:app --app-dir "$ROOT_DIR/backend" --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

echo "Iniciando Frontend React + Vite (Porta 5173)..."
cd "$ROOT_DIR/frontend"
npm run dev -- --port 5173 --host 0.0.0.0 &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true" EXIT
wait
