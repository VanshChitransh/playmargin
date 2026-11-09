#!/usr/bin/env bash
# Record real gameplay for the demo video and trailer: headless Chrome (agent-browser) captures
# #/watch, the director camera on a live match, for N seconds, then ffmpeg encodes an H.264 mp4
# at 60 fps. Nothing is staged: it films whatever the bots and agents actually do.
#
#   npm run record -w @margin/client -- [seconds] [out.mp4] [url]
#   defaults: 60 s, footage/watch-<time>.mp4, http://localhost:1234/?clean=1#/watch (needs npm run dev)
set -euo pipefail
cd "$(dirname "$0")/.."

SECS="${1:-60}"
OUT="${2:-footage/watch-$(date +%Y%m%d-%H%M%S).mp4}"
URL="${3:-http://localhost:1234/?clean=1#/watch}"
SESSION="record-$$"
RAW="$(mktemp -d)/raw.webm"
mkdir -p "$(dirname "$OUT")"

command -v agent-browser >/dev/null || { echo "needs agent-browser on PATH" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "needs ffmpeg on PATH" >&2; exit 1; }

cleanup() { agent-browser --session "$SESSION" close >/dev/null 2>&1 || true; }
trap cleanup EXIT

agent-browser --session "$SESSION" set viewport 1920 1080 >/dev/null
agent-browser --session "$SESSION" record start "$RAW" "$URL" >/dev/null
echo "recording $URL for ${SECS}s"
sleep "$SECS"
agent-browser --session "$SESSION" record stop >/dev/null

# The browser captures at its own frame rate; encode to a constant 60 fps for editors.
ffmpeg -loglevel error -y -i "$RAW" -vf "fps=60,scale=1920:1080:flags=lanczos" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart "$OUT"
echo "saved $OUT ($(du -h "$OUT" | cut -f1))"
