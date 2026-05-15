#!/bin/sh
# Build the vision-ocr binary. macOS-only; on other platforms this is a no-op
# (Vercel build runs on Linux and must not fail here).
set -e
if [ "$(uname)" != "Darwin" ]; then
  echo "build:ocr skipped (non-darwin platform: $(uname))"
  exit 0
fi
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
swift build -c release
echo "vision-ocr built: $HERE/.build/release/vision-ocr"
