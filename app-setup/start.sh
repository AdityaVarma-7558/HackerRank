#!/usr/bin/env bash
# Usage: start.sh <target-dir> <file> [--report <path>] [--recover]
# Starts the built editor in headless mode. Keystroke tokens are read from stdin, one per line.
# `exec` keeps the node process at this script's PID so the verifier can SIGKILL it directly.
set -eu

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "Usage: start.sh <target-dir> <file> [--report <path>] [--recover]" >&2
  exit 2
fi
shift

cd "$TARGET"
exec node dist/cli/index.js --headless "$@"
