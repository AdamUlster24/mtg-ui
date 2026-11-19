#!/usr/bin/env bash
# Builds the XMage server (engine, cards, game types) from the sibling ../mage checkout
# and installs the jars into ~/.m2 so the gateway can depend on them.
# Run again after every `git pull` in ../mage.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAGE_DIR="${MAGE_DIR:-$ROOT/../mage}"
GATEWAY_POM="$ROOT/gateway/pom.xml"

MAGE_VERSION="$(sed -n 's|^[[:space:]]*<mage-version>\([^<]*\)</mage-version>[[:space:]]*$|\1|p' "$MAGE_DIR/pom.xml")"
if [[ ! "$MAGE_VERSION" =~ ^[0-9][a-zA-Z0-9._+-]*$ ]]; then
    echo "Could not read the XMage Maven version from $MAGE_DIR/pom.xml" >&2
    exit 1
fi

GATEWAY_VERSION="$(sed -n 's|^[[:space:]]*<mage\.version>\([^<]*\)</mage\.version>[[:space:]]*$|\1|p' "$GATEWAY_POM")"
if [[ ! "$GATEWAY_VERSION" =~ ^[0-9][a-zA-Z0-9._+-]*$ ]]; then
    echo "Could not read mage.version from $GATEWAY_POM" >&2
    exit 1
fi

# Recompile cards and plugins against the current engine after updating the checkout.
MAVEN_OPTS="${MAVEN_OPTS:--Xmx6g}" "$ROOT/mvnw" -q -B -f "$MAGE_DIR/pom.xml" clean install \
    -DskipTests -Dmaven.javadoc.skip=true -pl Mage.Server -am
"$ROOT/scripts/sync-token-images.sh"

if [ "$MAGE_VERSION" != "$GATEWAY_VERSION" ]; then
    temp_pom="$(mktemp "$GATEWAY_POM.XXXXXX")"
    trap 'rm -f "$temp_pom"' EXIT
    cp -p "$GATEWAY_POM" "$temp_pom"
    sed "s|^\([[:space:]]*<mage\.version>\)[^<]*\(</mage\.version>[[:space:]]*\)\$|\1$MAGE_VERSION\2|" "$GATEWAY_POM" > "$temp_pom"
    mv "$temp_pom" "$GATEWAY_POM"
    echo "Updated gateway mage.version from $GATEWAY_VERSION to $MAGE_VERSION"
fi

echo "XMage built from $(git -C "$MAGE_DIR" rev-parse --short HEAD)"
