#!/usr/bin/env bash
set -euo pipefail

#if [ -f /Applications/Chromium.app/Contents/MacOS/Chromium ]; then
#   sudo ln -s /Applications/Chromium.app/Contents/MacOS/Chromium /usr/local/bin/chromium-browser
#fi
# Toddler Arcade — Raspberry Pi Chromium Kiosk Launcher
# Builds (if needed), serves static dist/ locally, and opens Chromium in fullscreen kiosk mode
# with Web Audio unlocked immediately for USB arcade joystick/button input.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PORT="${PORT:-4173}"

cd "$PROJECT_DIR"

if [ ! -d "dist" ]; then
  echo "Building Toddler Arcade..."
  npm run build
fi

# Start lightweight local HTTP server in background
python3 -m http.server "$PORT" --directory dist --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

# Wait briefly for server
sleep 1

CHROMIUM_BIN="chromium-browser"
if ! command -v "$CHROMIUM_BIN" >/dev/null 2>&1; then
  CHROMIUM_BIN="chromium"
fi

exec "$CHROMIUM_BIN" \
  --kiosk \
  --autoplay-policy=no-user-gesture-required \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --check-for-update-interval=31536000 \
  "http://127.0.0.1:${PORT}"
