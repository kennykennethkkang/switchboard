#!/bin/sh
# voice.sh start|stop|status: whisper-server (STT) and Kokoro (TTS) on localhost
# env and models live in ~/.claude/switchboard/voice
DIR="$HOME/.claude/switchboard/voice"
HERE="$(cd "$(dirname "$0")" && pwd)"
STT_PORT="${STT_PORT:-8178}"
TTS_PORT="${TTS_PORT:-8179}"
WHISPER="$(command -v whisper-server || echo /opt/homebrew/bin/whisper-server)"

# A pid file is trusted only while that pid still runs our server; a reused pid is stale.
want() { [ "$1" = stt ] && echo whisper-server || echo tts-server.py; }
up() {
  [ -f "$DIR/$1.pid" ] || return 1
  pid="$(cat "$DIR/$1.pid")"
  case "$(ps -p "$pid" -o command= 2>/dev/null)" in
    *"$(want "$1")"*) return 0 ;;
  esac
  rm -f "$DIR/$1.pid"
  return 1
}

start() {
  name=$1; shift
  if up "$name"; then echo "$name already running"; return; fi
  nohup "$@" >"$DIR/$name.log" 2>&1 &
  echo $! >"$DIR/$name.pid"
  echo "$name started (pid $!)"
}

stop() {
  if up "$1"; then kill "$(cat "$DIR/$1.pid")"; echo "$1 stopped"; fi
  rm -f "$DIR/$1.pid"
}

case "$1" in
  start)
    start stt "$WHISPER" -m "$DIR/models/ggml-base.en.bin" --host 127.0.0.1 --port "$STT_PORT"
    start tts "$DIR/.venv/bin/python" "$HERE/tts-server.py" "$TTS_PORT"
    ;;
  stop) stop stt; stop tts ;;
  status)
    for n in stt tts; do up $n && echo "$n up (pid $(cat "$DIR/$n.pid"))" || echo "$n down"; done
    ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 1 ;;
esac
