#!/usr/bin/env bash
# Resizes freshly generated PNG game-asset icons down to a web-friendly size
# and converts them to WebP, then removes the oversized PNG source.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$ROOT/src/assets/images"

find "$DIR" -name '*.png' | while read -r f; do
  out="${f%.png}.webp"
  convert "$f" -resize 512x512 -strip -quality 84 "$out"
  rm "$f"
  echo "optimized: $out"
done
