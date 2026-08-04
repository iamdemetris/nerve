#!/bin/bash
# Builds Nerve.app: a native WKWebView shell around the local daemon.
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$PACKAGE_DIR/../.." && pwd)"
APP_NAME="Nerve"
DIST="$PACKAGE_DIR/dist"
APP="$DIST/$APP_NAME.app"
CONTENTS="$APP/Contents"
DAEMON_SCRIPT="$REPO_ROOT/packages/workbench-server/dist/serve.js"

# The bundle records absolute paths because a Dock launch inherits a minimal
# PATH that excludes Homebrew.
NODE_PATH="$(command -v node)"
if [ -z "$NODE_PATH" ]; then
  echo "error: node not found on PATH" >&2
  exit 1
fi

if [ ! -f "$DAEMON_SCRIPT" ]; then
  echo "error: daemon not built. Run: pnpm build:workbench-runtime" >&2
  exit 1
fi

echo "==> Cleaning"
rm -rf "$APP"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"

echo "==> Compiling Swift shell"
# -Onone keeps the build fast; this is a thin host and never a hot path.
xcrun swiftc \
  -swift-version 5 \
  -target arm64-apple-macosx13.0 \
  -framework AppKit -framework WebKit \
  -O \
  -o "$CONTENTS/MacOS/$APP_NAME" \
  "$PACKAGE_DIR/Sources/main.swift"

echo "==> Building icon"
ICONSET="$DIST/$APP_NAME.iconset"
SOURCE_ICON="$REPO_ROOT/packages/desktop-shell/build/icons/1024x1024.png"
rm -rf "$ICONSET"; mkdir -p "$ICONSET"
for size in 16 32 64 128 256 512; do
  sips -z $size $size "$SOURCE_ICON" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z $double $double "$SOURCE_ICON" \
    --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$CONTENTS/Resources/$APP_NAME.icns"
rm -rf "$ICONSET"

echo "==> Writing Info.plist"
cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleExecutable</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>dev.nerve.workbench</string>
  <key>CFBundleIconFile</key><string>$APP_NAME</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.17.0</string>
  <key>CFBundleVersion</key><string>0.17.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
  <key>NerveNodePath</key><string>$NODE_PATH</string>
  <key>NerveDaemonScript</key><string>$DAEMON_SCRIPT</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
</dict>
</plist>
PLIST

# An ad-hoc signature is enough for local use and keeps Gatekeeper quiet;
# without it macOS treats each rebuild as a different app.
echo "==> Signing (ad-hoc)"
codesign --force --deep --sign - "$APP"

echo ""
echo "Built $APP"
echo "Install with: pnpm --filter @nervekit/mac-shell install:app"
