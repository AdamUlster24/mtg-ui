#!/usr/bin/env bash
# Builds the gateway + web client and starts everything on http://localhost:8080
# (XMage server runs inside the gateway process).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAGE_DIR="${MAGE_DIR:-$ROOT/../mage}"
RUN_DIR="${RUN_DIR:-$ROOT/run}"
XMAGE_PORT="${XMAGE_PORT:-17171}"
export XMAGE_PORT

# Use the gateway and dependencies built for the configured XMage version.
MAGE_VERSION="$(sed -n 's/.*<mage\.version>\([^<]*\)<\/mage\.version>.*/\1/p' "$ROOT/gateway/pom.xml")"
BUILD_DIR="$ROOT/gateway/target/$MAGE_VERSION"
LIB_DIR="$BUILD_DIR/lib"
if [ "${SKIP_BUILD:-0}" != "1" ]; then
    "$ROOT/mvnw" -q -B -f "$ROOT/gateway/pom.xml" package
fi
if [ ! -f "$BUILD_DIR/gateway-0.1.0.jar" ] || [ ! -f "$LIB_DIR/mage-server-$MAGE_VERSION.jar" ]; then
    echo "Gateway build for XMage $MAGE_VERSION is missing. Run scripts/run.sh without SKIP_BUILD=1." >&2
    exit 1
fi

if [ "${SKIP_BUILD:-0}" != "1" ] && [ "${SKIP_WEB:-0}" != "1" ]; then
    (cd "$ROOT/web" && { [ -d node_modules ] || npm install; } && npm run build)
fi

# XMage reads config/ and plugins/ relative to its working directory
mkdir -p "$RUN_DIR/config" "$RUN_DIR/plugins"
if [ ! -f "$RUN_DIR/config/config.xml" ]; then
    # only the gateway talks to XMage, so keep its port off the network
    # (secondaryBindPort is XMage's callback channel, it has to differ per server on one machine)
    sed -e 's/serverAddress="0.0.0.0"/serverAddress="127.0.0.1"/' \
        -e "s/ port=\"17171\"/ port=\"$XMAGE_PORT\"/" \
        -e "s/secondaryBindPort=\"17179\"/secondaryBindPort=\"$((XMAGE_PORT + 8))\"/" \
        -e "s/maxGameThreads=\"10\"/maxGameThreads=\"${XMAGE_MAX_GAMES:-10}\"/" \
        "$MAGE_DIR/Mage.Server/config/config.xml" > "$RUN_DIR/config/config.xml"
fi
export WEB_DIST="${WEB_DIST:-$ROOT/web/dist}"
rm -f "$RUN_DIR"/plugins/*.jar
for jar in "$LIB_DIR"/mage-{game,deck,player,tournament}-*.jar; do
    name="$(basename "$jar")"
    cp "$jar" "$RUN_DIR/plugins/${name%-[0-9]*.jar}.jar"
done

cd "$RUN_DIR"
# XMage's network layer (JBoss Remoting) reflects into JDK internals, which Java 17 only allows when opened
exec java -Xmx"${GATEWAY_HEAP:-3g}" \
    --add-opens java.base/java.io=ALL-UNNAMED \
    --add-opens java.base/java.lang=ALL-UNNAMED \
    --add-opens java.base/java.util=ALL-UNNAMED \
    --add-opens java.base/java.net=ALL-UNNAMED \
    -cp "$BUILD_DIR/gateway-0.1.0.jar:$LIB_DIR/*" \
    dev.mtgui.gateway.GatewayMain "$@"
