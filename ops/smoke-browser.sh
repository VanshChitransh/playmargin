#!/usr/bin/env bash
# Browser smoke after every deploy: a REAL Chrome (agent-browser) joins from playmargin.fun, so CORS,
# credentials and the client's own matchmake path are checked the way players hit them. curl and the
# Node smoke cannot catch a browser-only break (13 Nov P0: Allow-Credentials dropped, every join failed).
# Usage: ./ops/smoke-browser.sh   (needs agent-browser: npm i -g agent-browser && agent-browser install)
set -uo pipefail
SITE="${SITE:-https://playmargin.fun}"
fail=0
text() { agent-browser eval 'document.body.innerText' 2>/dev/null | tr '\n' ' '; }
check() { # name, wanted regex
  local t; t=$(text)
  if [[ "$t" =~ $2 ]] && [[ ! "$t" =~ "join right now" ]]; then echo "ok   $1"; else echo "FAIL $1: $(echo "$t" | cut -c1-160)"; fail=1; fi
}
code() { LC_ALL=C tr -dc 'A-Z' </dev/urandom | head -c 4; }

agent-browser open "$SITE/play" >/dev/null && sleep 8
# Any in-arena phase counts: the room may already be past warm-up when the page settles.
check "play free joins a public room" "WARM-UP|GET READY|COUNTDOWN|Finding players|GROW|HUNT|SQUEEZE|LIVE|Server: (Mumbai|US)"
for s in "" "?s=us"; do
  agent-browser open "$SITE/r/$(code)$s" >/dev/null && sleep 5
  agent-browser find role textbox fill --name "Player" "smoke" >/dev/null 2>&1
  agent-browser find role button click --name "Join room" >/dev/null 2>&1
  sleep 7
  check "private room ${s:-(Mumbai)}" "Waiting for friends"
done
agent-browser close >/dev/null 2>&1
exit $fail
