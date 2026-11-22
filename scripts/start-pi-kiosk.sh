#!/usr/bin/env bash
set -euo pipefail

# Toddler Arcade — Fullscreen Launcher (Raspberry Pi & macOS)
# Builds dist/, serves it locally, and opens Chromium/Chrome in fullscreen mode
# with Web Audio unlocked immediately for USB arcade joystick/button input.
#
# NOTE FOR macOS: Never invoke Chromium through a symlink in /usr/local/bin!
# Chromium on macOS uses its binary path to locate the outer .app bundle;
# invoking via a symlink causes Chromium Helper.app (GPU/Network) to crash at
# bundle_locations.mm:74. Always resolve or invoke the .app/Contents/MacOS binary directly.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PORT="${PORT:-4173}"
PROFILE_DIR="${TODDLER_ARCADE_PROFILE_DIR:-$HOME/.toddler-arcade-browser}"

cd "$PROJECT_DIR"

if command -v npm >/dev/null 2>&1; then
  echo "Building Toddler Arcade..."
  npm run build
elif [ ! -d "dist" ]; then
  echo "Error: dist/ folder not found and npm is not installed." >&2
  exit 1
fi

# Pick a free port starting from $PORT in case a previous server is still running
while lsof -Pi ":$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

# Start lightweight local HTTP server in background (cleaned up automatically on exit)
python3 -m http.server "$PORT" --directory dist --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 0.6

resolve_browser_bin() {
  # 1. On macOS, check .app bundles directly first so CFBundleGetMainBundle() always succeeds
  local mac_apps=(
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
    "$HOME/Applications/Chromium.app/Contents/MacOS/Chromium"
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
  )
  for app_bin in "${mac_apps[@]}"; do
    if [ -x "$app_bin" ]; then
      printf '%s\n' "$app_bin"
      return 0
    fi
  done

  # 2. Linux / Raspberry Pi / PATH fallback — resolve symlinks so macOS symlinks never break bundle lookup
  for cmd in chromium-browser chromium google-chrome-stable google-chrome; do
    if command -v "$cmd" >/dev/null 2>&1; then
      local found
      found="$(command -v "$cmd")"
      python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$found"
      return 0
    fi
  done

  return 1
}

if ! CHROMIUM_BIN="$(resolve_browser_bin)"; then
  echo "Error: Could not find Chromium or Google Chrome." >&2
  exit 1
fi

mkdir -p "$PROFILE_DIR"

echo "Launching Toddler Arcade at http://127.0.0.1:${PORT} using: $CHROMIUM_BIN"

# Run without `exec` so the EXIT trap cleanly stops python3 http.server when the window closes
"$CHROMIUM_BIN" \
  --user-data-dir="$PROFILE_DIR" \
  --start-fullscreen \
  --app="http://127.0.0.1:${PORT}" \
  --autoplay-policy=no-user-gesture-required \
  --no-first-run \
  --no-default-browser-check \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --check-for-update-interval=31536000
