#!/bin/bash
# Sign every Mach-O binary in a Windy Word .app for Apple notarization.
#
# `codesign --deep` has TWO known gaps that this script fixes:
#   1. It does NOT recurse into Python `.whl` zip files. Apple's notary DOES,
#      so every wheel-internal `.so`/`.dylib` must be signed before zipping.
#   2. It sometimes misses Electron Framework's `Libraries/lib{EGL,GLESv2,ffmpeg,vk_swiftshader}.dylib`
#      and `Squirrel.framework/.../ShipIt`. Sign them explicitly.
#
# After signing internals, re-seal frameworks → helper apps → outer .app in that
# order, because each container's CodeResources hashes its children.
#
# Usage:
#   sign-bundled.sh <path-to-.app>
#
# Required env vars:
#   CODESIGN_IDENTITY  e.g. "Developer ID Application: Grant Whitmer (VXZ434QL89)"
#   ENTITLEMENTS_PLIST e.g. /path/to/build/entitlements.mac.plist

set -euo pipefail

APP="${1:?must pass path to .app}"
IDENT="${CODESIGN_IDENTITY:?must set CODESIGN_IDENTITY env var}"
ENT="${ENTITLEMENTS_PLIST:?must set ENTITLEMENTS_PLIST env var}"
PRODUCT_SHORT="${PRODUCT_SHORT:-Windy Word}"  # bundle's helper-app prefix (matches productName)

echo "[sign-bundled] app=$APP"
echo "[sign-bundled] identity=$IDENT"
date '+[sign-bundled] %H:%M:%S start'

# --- 1. loose bundled Mach-O binaries (python interpreter, ffmpeg, tcl libs, .so dynload) ---
if [ -d "$APP/Contents/Resources/bundled" ]; then
  echo "[sign-bundled] 1/6 sign loose bundled binaries"
  # uv/uvx are extensionless Astral Mach-O binaries — notary rejects them as
  # "not signed / no hardened runtime" if missed (the sole 7-02 recut reject).
  find "$APP/Contents/Resources/bundled" \
    -type f \( -name "*.dylib" -o -name "*.so" -o -name "python3.11" -o -name "ffmpeg" -o -name "uv" -o -name "uvx" \) \
    ! -path "*/wheels/*" \
    -print0 | xargs -0 -n1 -I{} codesign --force --options runtime --timestamp --sign "$IDENT" "{}" 2>/dev/null
  # 1b: The bundled Python interpreter runs ctranslate2/oneDNN, which JIT-compiles its
  # compute kernels at inference. Under the hardened runtime that REQUIRES the
  # allow-jit / allow-unsigned-executable-memory entitlements — without them the engine
  # SEGFAULTS the instant it transcribes (the loose-sign above carries NO entitlements).
  # Re-sign the interpreter(s) WITH the app entitlements so the runtime venv (which
  # symlinks to this binary) can JIT. disable-library-validation (also in $ENT) lets the
  # venv's signed wheels load cleanly. Without this, offline dictation is dead on arrival.
  echo "[sign-bundled] 1b/6 re-sign Python interpreter WITH jit entitlements"
  find "$APP/Contents/Resources/bundled" -type f -name "python3.11" ! -path "*/wheels/*" -print0 \
    | xargs -0 -n1 -I{} codesign --force --options runtime --timestamp --entitlements "$ENT" --sign "$IDENT" "{}" 2>/dev/null
fi

# --- 2. Electron Framework Libraries + Helpers + Squirrel ShipIt (--deep misses these) ---
# 2026-05-17: chrome_crashpad_handler added — Electron 28 ships it under
# Frameworks/Electron Framework.framework/Versions/A/Helpers/. Not auto-signed
# by electron-builder; blocks framework reseal with "code object is not signed
# at all" if missed. Catch-all `find Helpers` covers any future additions.
echo "[sign-bundled] 2/6 sign Electron + Squirrel internals"
for f in \
  "$APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libEGL.dylib" \
  "$APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libGLESv2.dylib" \
  "$APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib" \
  "$APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libvk_swiftshader.dylib" \
  "$APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler" \
  "$APP/Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt"
do
  [ -e "$f" ] && codesign --force --options runtime --timestamp --sign "$IDENT" "$f" 2>/dev/null
done
# Catch-all: sign any other executable in Electron Framework Helpers/.
if [ -d "$APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers" ]; then
  find "$APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers" \
    -type f -perm -u+x \
    -print0 | xargs -0 -n1 -I{} codesign --force --options runtime --timestamp --sign "$IDENT" "{}" 2>/dev/null || true
fi

# --- 3. Wheel internals: extract, sign every .so/.dylib, rezip ---
WHEELS_DIR="$APP/Contents/Resources/bundled/wheels"
if [ -d "$WHEELS_DIR" ]; then
  echo "[sign-bundled] 3/6 sign wheel internals"
  WC=0; SC=0
  for whl in "$WHEELS_DIR"/*.whl; do
    [ -f "$whl" ] || continue
    WC=$((WC+1))
    T=$(mktemp -d)
    unzip -q "$whl" -d "$T"
    N=$(find "$T" -type f \( -name "*.so" -o -name "*.dylib" \) | wc -l | tr -d ' ')
    if [ "$N" -gt 0 ]; then
      find "$T" -type f \( -name "*.so" -o -name "*.dylib" \) -print0 \
        | xargs -0 -n1 -I{} codesign --force --options runtime --timestamp --sign "$IDENT" "{}" 2>/dev/null
      SC=$((SC+N))
    fi
    rm "$whl"
    (cd "$T" && zip -qrX "$whl" .)
    rm -rf "$T"
  done
  echo "[sign-bundled]   wheels=$WC binaries_signed_inside=$SC"
fi

# --- 4. Re-seal frameworks (their CodeResources now reference our newly signed internals) ---
echo "[sign-bundled] 4/6 reseal frameworks"
# Sign EVERY .framework under Contents/Frameworks — Squirrel pulls in
# Mantle.framework + ReactiveObjC.framework as separate top-level frameworks
# that are not auto-signed by electron-builder and block outer .app reseal
# with "code object is not signed at all". Iterate over the whole dir so
# future Electron / Squirrel dep additions don't surprise us.
for fw in "$APP/Contents/Frameworks/"*.framework; do
  [ -d "$fw" ] && codesign --force --options runtime --timestamp --sign "$IDENT" "$fw" 2>/dev/null
done

# --- 5. Re-seal helper .apps with entitlements ---
echo "[sign-bundled] 5/6 reseal helper apps"
for h in "$APP/Contents/Frameworks/$PRODUCT_SHORT Helper (GPU).app" \
         "$APP/Contents/Frameworks/$PRODUCT_SHORT Helper (Plugin).app" \
         "$APP/Contents/Frameworks/$PRODUCT_SHORT Helper (Renderer).app" \
         "$APP/Contents/Frameworks/$PRODUCT_SHORT Helper.app"; do
  [ -d "$h" ] && codesign --force --options runtime --timestamp \
    --entitlements "$ENT" --sign "$IDENT" "$h" 2>/dev/null
done

# --- 6. Re-seal outer .app ---
echo "[sign-bundled] 6/6 reseal outer .app"
codesign --force --options runtime --timestamp \
  --entitlements "$ENT" --sign "$IDENT" "$APP" 2>/dev/null

echo "[sign-bundled] verify"
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | tail -3

date '+[sign-bundled] %H:%M:%S done'
