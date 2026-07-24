#!/bin/bash
# Compile the Stage-7 "Send" Enter-tap helper for macOS bundling.
# No-op (soft-skip) on non-mac or when swiftc is unavailable — the feature just
# stays inert; nothing else in the build depends on it.
set -e
SRC="src/client/desktop/native/mac-enter-tap.swift"
OUT="build/mac/mac-enter-tap"
if [ "$(uname)" != "Darwin" ]; then echo "[enter-tap] not macOS — skip"; exit 0; fi
if ! command -v swiftc >/dev/null 2>&1; then echo "[enter-tap] swiftc not found — skip"; exit 0; fi
mkdir -p "$(dirname "$OUT")"
swiftc -O "$SRC" -o "$OUT"
echo "[enter-tap] built $OUT"
