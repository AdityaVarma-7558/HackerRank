#!/usr/bin/env bash
# Usage: reset.sh <target-dir>
# Deletes generated state so the next build starts clean: build output, installed
# dependencies, and any swap files left inside the target directory.
set -eu

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "Usage: reset.sh <target-dir>" >&2
  exit 2
fi
if [ ! -d "$TARGET" ]; then
  exit 0
fi

rm -rf "$TARGET/dist" "$TARGET/node_modules"
find "$TARGET" -maxdepth 3 -name '.*.swp' -type f -delete 2>/dev/null || true
