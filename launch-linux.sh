#!/usr/bin/env bash
# Launch CPU Heater as a fullscreen-locked desktop application
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "========================================================"
echo "  🚀 Launching CPU Heater (Fullscreen Locked Desktop App)"
echo "========================================================"

# Check if node & npm exist
if command -v npx >/dev/null 2>&1; then
    exec npx electron .
else
    # Fallback directly to Python backend with Chrome/Chromium kiosk mode
    echo "Electron not found, falling back to dedicated kiosk mode..."
    exec python3 main.py --kiosk
fi
