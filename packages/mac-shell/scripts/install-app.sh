#!/bin/bash
# Installs the built Nerve.app into /Applications.
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$PACKAGE_DIR/dist/Nerve.app"
TARGET="/Applications/Nerve.app"
TRASH_DIR="$HOME/.Trash"

if [ ! -d "$APP" ]; then
  echo "error: Nerve.app not built. Run: pnpm --filter @nervekit/mac-shell build" >&2
  exit 1
fi

# Replacing a running app leaves a broken bundle, so stop it first.
if pgrep -x "Nerve" >/dev/null 2>&1; then
  echo "==> Quitting the running Nerve app"
  osascript -e 'quit app "Nerve"' 2>/dev/null || pkill -x Nerve || true
  sleep 1
fi

echo "==> Installing to $TARGET"
if [ -e "$TARGET" ]; then
  BACKUP="$TRASH_DIR/Nerve-backup-$(date +%Y%m%d-%H%M%S).app"
  mkdir -p "$TRASH_DIR"
  mv "$TARGET" "$BACKUP"
  echo "==> Previous app moved to $BACKUP"
fi
cp -R "$APP" "$TARGET"

# Refresh Launch Services so Spotlight and the Dock pick the bundle up now.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$TARGET" 2>/dev/null || true

echo ""
echo "Installed. Open it from Spotlight or the Applications folder:"
echo "  open -a Nerve"
