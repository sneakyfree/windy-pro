#!/bin/bash
# ═══════════════════════════════════════════════
# Windy Pro — Release Build Script
# Builds distributable packages for all platforms.
#
# Usage:
#   ./scripts/build-release.sh           # Build for current platform
#   ./scripts/build-release.sh all       # Build for all platforms
#   ./scripts/build-release.sh linux     # Build Linux only
#   ./scripts/build-release.sh mac       # Build macOS only
#   ./scripts/build-release.sh win       # Build Windows only
# ═══════════════════════════════════════════════

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

VERSION=$(node -p "require('./package.json').version")
echo "════════════════════════════════════════"
echo "  Windy Pro v${VERSION} — Release Build"
echo "════════════════════════════════════════"

# Ensure dependencies are installed
echo "📦 Installing dependencies…"
npm ci --prefer-offline 2>/dev/null || npm install

# Clean previous build
echo "🧹 Cleaning dist/…"
rm -rf dist/

TARGET="${1:-current}"

case "$TARGET" in
  all)
    echo "🔨 Building for ALL platforms (Linux, macOS, Windows)…"
    npx electron-builder --linux deb AppImage --mac dmg --win nsis --publish never
    ;;
  linux)
    echo "🐧 Building for Linux…"
    npx electron-builder --linux deb AppImage --publish never
    ;;
  mac)
    echo "🍎 Building for macOS…"
    npx electron-builder --mac dmg --publish never
    ;;
  win)
    echo "🪟 Building for Windows…"
    npx electron-builder --win nsis --publish never
    ;;
  current)
    echo "🔨 Building for current platform…"
    npx electron-builder --publish never
    ;;
  publish)
    echo "🚀 Building + Publishing to GitHub Releases…"
    npx electron-builder --linux deb AppImage --mac dmg --win nsis --publish always
    ;;
  *)
    echo "❌ Unknown target: $TARGET"
    echo "Usage: $0 [all|linux|mac|win|current|publish]"
    exit 1
    ;;
esac

echo ""
echo "✅ Build complete! Artifacts in dist/:"
ls -la dist/*.{deb,AppImage,dmg,exe,yml} 2>/dev/null || ls -la dist/
echo ""
echo "To publish to GitHub Releases:"
echo "  ./scripts/build-release.sh publish"
echo ""
echo "Or manually upload to:"
echo "  https://github.com/sneakyfree/windy-pro/releases/new?tag=v${VERSION}"
