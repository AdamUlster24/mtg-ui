#!/usr/bin/env bash
# Builds the XMage server (engine, cards, game types) from the sibling ../mage checkout
# and installs the jars into ~/.m2 so the gateway can depend on them.
# Run again after every `git pull` in ../mage.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAGE_DIR="${MAGE_DIR:-$ROOT/../mage}"

MAVEN_OPTS="${MAVEN_OPTS:--Xmx6g}" "$ROOT/mvnw" -q -B -f "$MAGE_DIR/pom.xml" install \
    -DskipTests -Dmaven.javadoc.skip=true -pl Mage.Server -am
echo "XMage built from $(git -C "$MAGE_DIR" rev-parse --short HEAD)"
