#!/usr/bin/env bash
# The three "How it works" loops on the #/how page, filmed from real play in offline practice
# (core rules, labelled bots). Nothing is staged or edited beyond trimming:
#   nitro:      hold BOOST after GO, the blob grows, the fuel ring drains
#   repay:      borrow to the cap, steer into spikes until the rim turns red, hold REPAY to PAID OFF
#   liquidated: same, but no REPAY: stay red until a bot or the vault pops the blob
# Each is trimmed to a few seconds, scaled to 480 px and encoded as a small muted mp4.
#   npm run clips -w @margin/client -- [nitro|repay|liquidated ...]   (default: all three)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=public/clips
TMP="$(mktemp -d)"
mkdir -p "$OUT"
S="clips-$$"
URL="http://localhost:1234/?local&view=1100#/play"
ab() { agent-browser --session "$S" "$@"; }
trap 'ab close >/dev/null 2>&1 || true' EXIT
press() { ab eval "dispatchEvent(new KeyboardEvent('$1',{code:'$2'}))" >/dev/null; }
until_live() { for _ in $(seq 1 60); do [ "$(ab eval 'window.__frame?.match.phase' 2>/dev/null)" = '"LIVE"' ] && return; sleep 0.5; done; }
since() { echo "$(( $(date +%s) - $1 ))"; }
encode() { # raw start seconds out
  local ss=$(( $2 < 0 ? 0 : $2 ))
  ffmpeg -loglevel error -y -ss "$ss" -t "$3" -i "$1" -an -vf "fps=30,scale=480:-2:flags=lanczos" -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -movflags +faststart "$OUT/$4"
  echo "$OUT/$4 $(du -h "$OUT/$4" | cut -f1)"
}
STEER='(() => { const f = __frame, me = f && f.blobs.find((b) => b.id === f.me); if (!me || me.state !== "alive") return "dead";
  if (me.ring === "red") return "red"; let best = null, bd = 1e9;
  for (const s of f.spikes) { const d = Math.hypot(s.x - me.x, s.y - me.y); if (d < bd) { bd = d; best = s; } }
  if (!best) return [innerWidth / 2 + 200, innerHeight / 2].join(" ");
  const n = Math.hypot(best.x - me.x, best.y - me.y) || 1;
  return [Math.round(innerWidth / 2 + (best.x - me.x) / n * 250), Math.round(innerHeight / 2 + (best.y - me.y) / n * 250)].join(" "); })()'

# Borrow to the cap, then chase spikes until red. Prints seconds since T0 when red, or nothing.
go_red() {
  press keydown Space; sleep 3; press keyup Space
  for _ in $(seq 1 80); do
    R=$(ab eval "$STEER" | tr -d '"')
    [ "$R" = "red" ] && { since "$1"; return; }
    [ "$R" = "dead" ] && return
    set -- "$1" $R; ab mouse move "$2" "$3" >/dev/null; sleep 0.3
  done
}

ab set viewport 640 640 >/dev/null
ab open "http://localhost:1234/#/" >/dev/null
ab eval 'localStorage.setItem("margin.coached","1"); localStorage.setItem("margin.muted","1")' >/dev/null

for CLIP in "${@:-nitro repay liquidated}"; do for C in $CLIP; do
  case "$C" in
  nitro)
    ab record start "$TMP/n.webm" "$URL" >/dev/null
    T0=$(date +%s); until_live; sleep 5.5
    A=$(since "$T0"); press keydown Space; sleep 2.2; press keyup Space; sleep 1.5
    ab record stop >/dev/null
    encode "$TMP/n.webm" "$((A - 1))" 5 nitro.mp4 ;;
  repay)
    ab record start "$TMP/r.webm" "$URL" >/dev/null
    T0=$(date +%s); until_live; sleep 5.5
    RED=$(go_red "$T0")
    sleep 0.8; press keydown KeyR
    for _ in $(seq 1 30); do [ "$(ab eval '(__frame.blobs.find(b=>b.id===__frame.me)?.owe ?? 0) < 0.5')" = "true" ] && break; sleep 0.1; done
    sleep 0.4; press keyup KeyR; sleep 1.8
    ab record stop >/dev/null
    if [ -n "$RED" ]; then encode "$TMP/r.webm" "$((RED - 2))" 5 repay.mp4; else echo "repay: never went red, rerun" >&2; fi ;;
  liquidated)
    ab record start "$TMP/l.webm" "$URL" >/dev/null
    T0=$(date +%s); until_live; sleep 5.5
    RED=$(go_red "$T0"); HIT=""
    ab mouse move 320 320 >/dev/null
    for _ in $(seq 1 60); do case "$(ab eval 'document.querySelector(".stamp")?.textContent ?? ""')" in *LIQUIDATED*) HIT=$(since "$T0"); break ;; *EATEN*) break ;; esac; sleep 0.5; done
    sleep 2
    ab record stop >/dev/null
    # Only a pop counts (the card says "Stay red, get popped"); an EATEN death is a rerun.
    if [ -n "$HIT" ]; then encode "$TMP/l.webm" "$((HIT - 4))" 6 liquidated.mp4; else echo "liquidated: no pop (eaten or none), rerun" >&2; fi ;;
  esac
done; done
