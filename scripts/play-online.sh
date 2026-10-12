#!/usr/bin/env bash
# One command to play with a friend over the internet:
# starts the game server, opens a public tunnel to it and prints the link and password to share.
#
#   scripts/play-online.sh                     # Cloudflare quick tunnel (no account needed)
#   TUNNEL=tailscale scripts/play-online.sh    # Tailscale Funnel instead
#   GATEWAY_PASSWORD=secret scripts/play-online.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export RUN_DIR="${RUN_DIR:-$ROOT/run}"
export GATEWAY_PORT="${GATEWAY_PORT:-8080}"
TUNNEL="${TUNNEL:-cloudflare}"
# the link is public, so there is always a password; a random one unless you choose it
export GATEWAY_PASSWORD="${GATEWAY_PASSWORD:-$(LC_ALL=C tr -dc 'a-z0-9' < /dev/urandom | head -c 10 || true)}"

mkdir -p "$RUN_DIR"
INFO="$RUN_DIR/online.json"
rm -f "$INFO"
PIDS=()
cleanup() {
    for pid in "${PIDS[@]:-}"; do
        [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
    done
    rm -f "$INFO"
}
trap cleanup EXIT INT TERM

echo "Starting the game server (the first start takes about a minute)..."
"$ROOT/scripts/run.sh" > "$RUN_DIR/gateway.out" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 600); do
    if curl -fs -m 2 "http://localhost:$GATEWAY_PORT/api/health" > /dev/null 2>&1; then break; fi
    if ! kill -0 "${PIDS[0]}" 2>/dev/null; then
        echo "The server stopped while starting, see $RUN_DIR/gateway.out" >&2
        exit 1
    fi
    sleep 1
done
curl -fs -m 2 "http://localhost:$GATEWAY_PORT/api/health" > /dev/null || { echo "The server did not start, see $RUN_DIR/gateway.out" >&2; exit 1; }

URL=""
case "$TUNNEL" in
cloudflare)
    command -v cloudflared > /dev/null || {
        echo "cloudflared is not installed: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" >&2
        echo "(or use TUNNEL=tailscale, or TUNNEL=none and forward port $GATEWAY_PORT yourself)" >&2
        exit 1
    }
    cloudflared tunnel --no-autoupdate --url "http://localhost:$GATEWAY_PORT" > "$RUN_DIR/tunnel.out" 2>&1 &
    PIDS+=($!)
    for _ in $(seq 1 60); do
        URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$RUN_DIR/tunnel.out" | head -1 || true)"
        [ -n "$URL" ] && break
        sleep 1
    done
    ;;
tailscale)
    tailscale funnel --bg "$GATEWAY_PORT" > "$RUN_DIR/tunnel.out" 2>&1 || true
    URL="$(grep -oE 'https://[a-zA-Z0-9.-]+\.ts\.net[^ ]*' "$RUN_DIR/tunnel.out" | head -1 || true)"
    ;;
none)
    URL="http://<your address>:$GATEWAY_PORT"
    ;;
*)
    echo "Unknown TUNNEL=$TUNNEL (cloudflare, tailscale or none)" >&2
    exit 1
    ;;
esac
[ -n "$URL" ] || { echo "The tunnel did not come up, see $RUN_DIR/tunnel.out" >&2; exit 1; }

if [ "$TUNNEL" = cloudflare ]; then
    # the link exists a little before it works everywhere
    for _ in $(seq 1 60); do
        if curl -fs -m 5 "$URL/api/health" > /dev/null 2>&1; then break; fi
        sleep 1
    done
fi

printf '{"url":"%s","password":"%s","local":"http://localhost:%s"}\n' "$URL" "$GATEWAY_PASSWORD" "$GATEWAY_PORT" > "$INFO"
cat <<BANNER

  Ready. Send your friend this:

      Link:      $URL
      Password:  $GATEWAY_PASSWORD

  You can use the same link, or http://localhost:$GATEWAY_PORT on this machine.
  Keep this window open while you play; Ctrl+C stops everything.

BANNER
wait "${PIDS[0]}"
