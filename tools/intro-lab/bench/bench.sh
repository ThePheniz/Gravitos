#!/usr/bin/env bash
# On-TV intro benchmark. Packages tools/intro-lab/bench/app as a SEPARATE app (GravBench1.Bench,
# never touches GravPlex01.Gravitos), installs it on the TV with the given renderer(s), runs it,
# collects results over HTTP (TV -> node listener on this PC) and prints a summary.
#
#   bash tools/intro-lab/bench/bench.sh tools/intro-lab/a/splash-gl.js            # one renderer
#   bash tools/intro-lab/bench/bench.sh k=0.5 js/splash-gl.js tools/intro-lab/b/splash-gl.js
#   bash tools/intro-lab/bench/bench.sh --suite                                  # synthetic GPU budgets (~4 min)
#   options: k=<canvas scale of 1920x1080, default 0.5 like the app>  q=<renderer quality knob, passed as ?q=>  modes=worker,worker-words-busy,...  go=<ms, default 4400>
#            only=<regex on suite group names, e.g. only=alufine|parts; implies --suite>
#            --keep (leave the bench app installed)   env: TV=192.168.4.40 PORT=18765 PC_IP=auto PROFILE=gravitos
# Renderer modes: worker | worker-busy | worker-words | worker-words-busy | main | main-busy
#   (busy = main thread runs 30-80 ms JS blocks like Home loading; words = the real HTML wordmark layer on top)
# Results: tools/intro-lab/bench/results/<stamp>.ndjson ; re-print with node server.mjs --summary <file>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
TZ_HOME="${TIZEN_HOME:-$HOME/tizen-studio}"; TIZEN="$TZ_HOME/tools/ide/bin/tizen.bat"; SDB="$TZ_HOME/tools/sdb.exe"
TV="${TV:-192.168.4.40}"; SERIAL="$TV:26101"; PORT="${PORT:-18765}"; PROFILE="${PROFILE:-gravitos}"
APP=GravBench1.Bench
PC_IP="${PC_IP:-$(powershell -NoProfile -Command "(Find-NetRoute -RemoteIPAddress $TV | Select-Object -First 1).IPAddress" | tr -d '\r\n')}"

K=0.5; Q=null; ONLY=null; GO=4400; SUITE=false; KEEP=false; MODES="worker,worker-words-busy,worker-busy,main,main-busy"; FILES=()
for a in "$@"; do
  case "$a" in
    --suite) SUITE=true ;; --keep) KEEP=true ;;
    k=*) K="${a#k=}" ;; q=*) Q="'${a#q=}'" ;; only=*) ONLY="'${a#only=}'"; SUITE=true ;; go=*) GO="${a#go=}" ;; modes=*) MODES="${a#modes=}" ;;
    *) FILES+=("$a") ;;
  esac
done
[ ${#FILES[@]} -eq 0 ] && ! $SUITE && FILES=(js/splash-gl.js)

STAGE="$(cygpath -u "$LOCALAPPDATA")/Temp/gravbench-stage"
rm -rf "$STAGE"; mkdir -p "$STAGE/app/r" "$STAGE/out" "$HERE/results"
cp "$HERE"/app/* "$STAGE/app/"
cp -r "$ROOT/css" "$ROOT/fonts" "$STAGE/app/"
RJSON=""
for i in "${!FILES[@]}"; do
  f="${FILES[$i]}"; [ -f "$f" ] || f="$ROOT/$f"; [ -f "$f" ] || { echo "no such renderer: ${FILES[$i]}"; exit 1; }
  name="$(basename "$(dirname "$f")")"; [ "$name" = js ] && name=current
  cp "$f" "$STAGE/app/r/r$i.js"
  CSS=""; if [ -f "$(dirname "$f")/words.css" ]; then cp "$(dirname "$f")/words.css" "$STAGE/app/r/r$i.css"; CSS=",\"css\":\"r/r$i.css\""; fi
  RJSON="$RJSON{\"name\":\"$name\",\"file\":\"r/r$i.js\"$CSS},"
done
STAMP="$(date +%Y%m%d-%H%M%S)"
MJSON="\"$(echo "$MODES" | sed 's/,/","/g')\""
cat > "$STAGE/app/plan.js" <<EOF
window.PLAN = { server: 'http://$PC_IP:$PORT', run: '$STAMP', k: $K, q: $Q, only: $ONLY, go: $GO, suite: $SUITE, renderers: [${RJSON%,}], modes: [$MJSON] };
EOF
cat "$STAGE/app/plan.js"

W="$(cygpath -w "$STAGE")"
"$TIZEN" package -t wgt -s "$PROFILE" -o "$W\\out" -- "$W\\app" >/dev/null || { echo "tizen package failed"; exit 1; }
WGT="$(ls "$STAGE/out" | grep '\.wgt$' | head -1)"

OUT="$HERE/results/$STAMP.ndjson"
node "$HERE/server.mjs" --port "$PORT" --out "$OUT" --timeout 1500 &
SRV=$!
"$SDB" connect "$SERIAL" >/dev/null
"$TIZEN" install -s "$SERIAL" -n "$WGT" -- "$W\\out" | grep -iE "install|error|fail" | tail -2
"$TIZEN" run -s "$SERIAL" -p "$APP" | tail -1
set +e; wait $SRV; RC=$?; set -e
$KEEP || "$TIZEN" uninstall -s "$SERIAL" -p "$APP" | grep -iE "uninstall|error|fail" | tail -1
exit $RC
