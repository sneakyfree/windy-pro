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
PRODUCT_SHORT="${PRODUCT_SHORT:-Windy Pro}"  # bundle's helper-app prefix

echo "[sign-bundled] app=$APP"
echo "[sign-bundled] identity=$IDENT"
date '+[sign-bundled] %H:%M:%S start'

# --- 1. loose bundled Mach-O binaries (python interpreter, ffmpeg, tcl libs, .so dynload) ---
if [ -d "$APP/Contents/Resources/bundled" ]; then
  echo "[sign-bundled] 1/6 sign loose bundled binaries"
  find "$APP/Contents/Resources/bundled" \
    -type f \( -name "*.dylib" -o -name "*.so" -o -name "python3.11" -o -name "ffmpeg" \) \
    ! -path "*/wheels/*" \
    -print0 | xargs -0 -n1 -I{} codesign --force --options runtime --timestamp --sign "$IDENT" "{}" 2>/dev/null
fi

# --- 2. Electron Framework Libraries + Squirrel ShipIt (--deep misses these) ---
echo "[sign-bundled] 2/6 sign Electron + Squirrel internals"
for f in \
  "$APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libEGL.dylib" \
  "$APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libGLESv2.dylib" \
  "$APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib" \
  "$APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libvk_swiftshader.dylib" \
  "$APP/Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt"
do
  [ -e "$f" ] && codesign --force --options runtime --timestamp --sign "$IDENT" "$f" 2>/dev/null
done

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
for fw in "$APP/Contents/Frameworks/Electron Framework.framework" \
          "$APP/Contents/Frameworks/Squirrel.framework"; do
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
