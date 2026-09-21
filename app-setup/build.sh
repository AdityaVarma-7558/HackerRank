#!/usr/bin/env bash
# Usage: build.sh <target-dir>
# Installs dependencies and compiles the solution in <target-dir> (reference/, a model workspace, or a mutant).
set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "Usage: build.sh <target-dir>" >&2
  exit 2
fi
if [ ! -f "$TARGET/package.json" ]; then
  echo "build.sh: $TARGET has no package.json" >&2
  exit 1
fi

cd "$TARGET"
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi
npm run build

if [ ! -f dist/cli/index.js ]; then
  echo "build.sh: build finished but dist/cli/index.js was not produced" >&2
  exit 1
fi
