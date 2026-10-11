#!/usr/bin/env bash
# Stops the e2e servers that were left running with E2E_KEEP_SERVERS=1 (found by their ports)
for port in 8090 8091; do
    pid="$(ss -ltnpH "sport = :$port" 2>/dev/null | sed -nE 's/.*pid=([0-9]+).*/\1/p' | head -1)"
    if [ -n "$pid" ]; then kill "$pid"; fi
done
true
