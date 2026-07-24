#!/bin/bash
# Build the Stage-7 native Enter monitor (native/enter-monitor) against the
# installed Electron's ABI, for bundling. Soft-skips off-mac so cross-platform
# builds don't fail; the feature is macOS-only and stays inert elsewhere.
set -e
if [ "$(uname)" != "Darwin" ]; then echo "[enter-monitor] not macOS — skip"; exit 0; fi
ELECTRON_VERSION="$(node -p "require('./node_modules/electron/package.json').version")"
ARCH="$(node -p "process.arch")"
echo "[enter-monitor] building for electron ${ELECTRON_VERSION} (${ARCH})"
cd native/enter-monitor
export npm_config_target="${ELECTRON_VERSION}"
export npm_config_runtime=electron
export npm_config_disturl=https://electronjs.org/headers
export npm_config_arch="${ARCH}"
export npm_config_target_arch="${ARCH}"
npx --yes node-gyp rebuild
echo "[enter-monitor] built build/Release/enter_monitor.node"
