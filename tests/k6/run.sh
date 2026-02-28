#!/usr/bin/env bash
set -euo pipefail

node tests/k6/server.mjs &
SERVER_PID=$!

trap "kill $SERVER_PID 2>/dev/null || true" EXIT INT TERM

sleep 2
k6 run tests/k6/test.ts
