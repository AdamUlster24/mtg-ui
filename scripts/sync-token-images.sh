#!/usr/bin/env bash
# XMage keeps its "which Scryfall image belongs to which token / emblem" table inside the Swing
# client's sources. Extract it into a plain data file for the gateway (run by build-mage.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAGE_DIR="${MAGE_DIR:-$ROOT/../mage}"
SRC="$MAGE_DIR/Mage.Client/src/main/java/org/mage/plugins/card/dl/sources/ScryfallImageSupportTokens.java"
OUT="$ROOT/gateway/src/main/resources/token-images.tsv"

mkdir -p "$(dirname "$OUT")"
# lines look like:   put("XLN/Treasure/1", "https://api.scryfall.com/cards/txln/7/en?format=image");
sed -nE 's|^[[:space:]]*put\("([^"]+)",[[:space:]]*"([^"]+)"\);.*|\1\t\2|p' "$SRC" > "$OUT"
echo "token images: $(wc -l < "$OUT") entries"
