#!/usr/bin/env bash
# ═══════════════════════════════════
#  Windy Pro — Build .deb Package
#  Builds an amd64 .deb using electron-builder
# ═══════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Read version from package.json
VERSION=$(node -pe "require('./package.json').version")
echo "🌪️  Building Windy Pro v${VERSION} .deb package..."

# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing npm dependencies..."
  npm install
fi

# Ensure devDependencies (electron-builder) are available
if ! npx electron-builder --version &>/dev/null; then
  echo "⚠️  electron-builder not found. Installing..."
  npm install --save-dev electron-builder
fi

# Clean previous builds
rm -rf dist/

# Build .deb for amd64
echo "🔨 Building .deb for amd64..."
npx electron-builder build \
  --linux deb \
  --x64 \
  --config.extraMetadata.version="$VERSION"

# Check output
DEB_FILE=$(find dist/ -name "*.deb" -type f | head -1)
if [ -n "$DEB_FILE" ]; then
  echo ""
  echo "✅ Build complete!"
  echo "📁 Output: $DEB_FILE"
  echo "📊 Size: $(du -h "$DEB_FILE" | cut -f1)"
  echo ""
  echo "Install with:"
  echo "  sudo dpkg -i $DEB_FILE"
  echo "  sudo apt-get install -f  # fix dependencies if needed"
else
  echo "❌ Build failed — no .deb file found in dist/"
  exit 1
fi
