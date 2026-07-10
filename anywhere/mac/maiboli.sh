#!/bin/bash
# Maiboli Anywhere (macOS) — system-wide voice dictation, any language -> English.
#
# Press your hotkey once: starts recording.
# Press it again: stops, transcribes+translates, and pastes at your cursor
# in WHATEVER app is focused. If pasting fails, the text stays on the clipboard.
#
# Config lives in ~/.config/maiboli/config (created on first run).

set -u

CONF_DIR="$HOME/.config/maiboli"
CONF="$CONF_DIR/config"
PIDFILE="${TMPDIR:-/tmp}/maiboli-rec.pid"
WAV="${TMPDIR:-/tmp}/maiboli-rec.wav"

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"Maiboli\"" >/dev/null 2>&1
}

# ---- First run: create a config template and stop ----
if [ ! -f "$CONF" ]; then
  mkdir -p "$CONF_DIR"
  cat > "$CONF" <<'EOF'
# Maiboli Anywhere config
# PROVIDER: "whisper" (OpenAI, any language -> English) or "sarvam" (Indian languages)
PROVIDER=whisper
OPENAI_API_KEY=
SARVAM_API_KEY=
EOF
  notify "First run: add your API key in ~/.config/maiboli/config"
  open -e "$CONF" 2>/dev/null
  exit 0
fi

# shellcheck disable=SC1090
source "$CONF"

# ---- Find sox ----
SOX="$(command -v sox || true)"
[ -z "$SOX" ] && for p in /opt/homebrew/bin/sox /usr/local/bin/sox; do
  [ -x "$p" ] && SOX="$p" && break
done
if [ -z "$SOX" ]; then
  notify "sox not found — run: brew install sox"
  exit 1
fi

# ---- Toggle: currently recording? stop + transcribe ----
if [ -f "$PIDFILE" ]; then
  PID="$(cat "$PIDFILE")"
  rm -f "$PIDFILE"
  kill -INT "$PID" 2>/dev/null
  # wait for sox to finalize the file
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.1
  done

  if [ ! -s "$WAV" ] || [ "$(stat -f%z "$WAV")" -lt 2000 ]; then
    rm -f "$WAV"
    notify "Recording was empty — check microphone permission."
    exit 1
  fi

  notify "Transcribing…"

  if [ "${PROVIDER:-whisper}" = "sarvam" ]; then
    if [ -z "${SARVAM_API_KEY:-}" ]; then notify "Add SARVAM_API_KEY in ~/.config/maiboli/config"; exit 1; fi
    RESP="$(curl -s --max-time 60 https://api.sarvam.ai/speech-to-text-translate \
      -H "api-subscription-key: $SARVAM_API_KEY" \
      -F model="saaras:v2.5" \
      -F "file=@$WAV;type=audio/wav")"
    TEXT="$(printf '%s' "$RESP" | /usr/bin/python3 -c 'import sys,json
try: d=json.load(sys.stdin); print((d.get("transcript") or d.get("text") or "").strip())
except Exception: pass')"
  else
    if [ -z "${OPENAI_API_KEY:-}" ]; then notify "Add OPENAI_API_KEY in ~/.config/maiboli/config"; exit 1; fi
    RESP="$(curl -s --max-time 60 https://api.openai.com/v1/audio/translations \
      -H "Authorization: Bearer $OPENAI_API_KEY" \
      -F model="whisper-1" \
      -F "file=@$WAV")"
    TEXT="$(printf '%s' "$RESP" | /usr/bin/python3 -c 'import sys,json
try: d=json.load(sys.stdin); print((d.get("text") or "").strip())
except Exception: pass')"
  fi
  rm -f "$WAV"

  if [ -z "$TEXT" ]; then
    notify "No speech detected (or API error)."
    exit 1
  fi

  # Clipboard first (also the fallback), then simulate Cmd+V at the cursor.
  printf '%s' "$TEXT" | /usr/bin/pbcopy
  if /usr/bin/osascript -e 'tell application "System Events" to keystroke "v" using command down' >/dev/null 2>&1; then
    :
  else
    notify "Copied to clipboard — press Cmd+V to paste. (Grant Accessibility permission for auto-paste.)"
  fi
  exit 0
fi

# ---- Not recording: start ----
rm -f "$WAV"
"$SOX" -q -d -r 16000 -c 1 -b 16 "$WAV" >/dev/null 2>&1 &
echo $! > "$PIDFILE"
notify "Recording… press the hotkey again to stop."
