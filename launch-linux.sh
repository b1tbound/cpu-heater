#!/usr/bin/env bash
# Launch CPU Heater as a fullscreen-locked desktop application
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "========================================================"
echo "  🚀 Launching CPU Heater (Fullscreen Locked Desktop App)"
echo "========================================================"

# Clear ELECTRON_RUN_AS_NODE so Electron runs as a GUI application rather than node
export ELECTRON_RUN_AS_NODE=

if [ -f "./node_modules/.bin/electron" ]; then
    exec env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .
elif command -v npx >/dev/null 2>&1; then
    exec env -u ELECTRON_RUN_AS_NODE npx electron .
else
    echo "Electron binary not found, falling back to dedicated kiosk mode..."
    exec python3 main.py --kiosk
fi
