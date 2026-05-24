#!/bin/sh
# Auto-detect fastest npm registry by latency probe
# Outputs registry URL to stdout on success, exits 1 on failure

set -e

NPMJS="https://registry.npmjs.org"
CDN="https://registry.npmmirror.com"
TIMEOUT=5

measure() {
    url="$1"
    start=$(date +%s%3N)
    if curl -sf --max-time "$TIMEOUT" "$url" > /dev/null 2>&1; then
        end=$(date +%s%3N)
        echo $((end - start))
        return 0
    fi
    return 1
}

echo "Probing registry latency..."

cdnpm_ms=$(measure "$CDN")
if [ $? -eq 0 ]; then
    echo "Chinese CDN: ${cdnpm_ms}ms"
else
    echo "Chinese CDN: failed"
fi

npmjs_ms=$(measure "$NPMJS")
if [ $? -eq 0 ]; then
    echo "npmjs.org: ${npmjs_ms}ms"
else
    echo "npmjs.org: failed"
fi

if [ -n "$cdnpm_ms" ] && [ -n "$npmjs_ms" ]; then
    if [ "$cdnpm_ms" -le "$npmjs_ms" ]; then
        echo "Selected: $CDN (fastest)"
        echo "$CDN"
        exit 0
    else
        echo "Selected: $NPMJS (fastest)"
        echo "$NPMJS"
        exit 0
    fi
elif [ -n "$cdnpm_ms" ]; then
    echo "Selected: $CDN (fallback: only reachable)"
    echo "$CDN"
    exit 0
elif [ -n "$npmjs_ms" ]; then
    echo "Selected: $NPMJS (fallback: only reachable)"
    echo "$NPMJS"
    exit 0
else
    echo "ERROR: No registries reachable"
    exit 1
fi