#!/bin/bash
# Kokoro Playground SPA launcher
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env"
  set +a
fi

# Optional: keep system awake while the hub runs (display may sleep)
# Set KEEP_AWAKE=1 (or true/yes/on) to re-exec this script under caffeinate -ims
KEEP_AWAKE="${KEEP_AWAKE:-0}"
_ka() {
  printf '%s' "$KEEP_AWAKE" | tr '[:upper:]' '[:lower:]'
}
if [[ "$(_ka)" =~ ^(1|true|yes|on)$ && -z "${CAFFEINATED:-}" ]]; then
  if command -v caffeinate >/dev/null 2>&1; then
    export CAFFEINATED=1
    echo "[Kokoro SPA] KEEP_AWAKE=1 → starting under caffeinate -ims (screen may sleep; system stays awake)"
    exec caffeinate -ims /bin/bash "$0"
  else
    echo "[Kokoro SPA] KEEP_AWAKE=1 set but 'caffeinate' not found; continuing without it."
  fi
fi

# Print keep-awake status hint once we're in the final execution context
if command -v caffeinate >/dev/null 2>&1; then
  if [[ -n "${CAFFEINATED:-}" ]]; then
    echo "[Kokoro SPA] Power: keep-awake=ON via caffeinate -ims (display may sleep; system/network stay awake). Unset KEEP_AWAKE to allow normal sleep."
  else
    if [[ "$(_ka)" =~ ^(1|true|yes|on)$ ]]; then
      echo "[Kokoro SPA] Power: keep-awake requested but not active in this process. Tip: set KEEP_AWAKE=1 before launching to enable (requires 'caffeinate')."
    else
      echo "[Kokoro SPA] Power: keep-awake=OFF. Tip: set KEEP_AWAKE=1 to keep system awake while the hub runs."
    fi
  fi
else
  echo "[Kokoro SPA] Power: 'caffeinate' not found; keep-awake unavailable. Install Xcode command line tools or use clamshell/WoL as needed."
fi
FRONTEND_DIR="${FRONTEND_DIR:-$ROOT_DIR/frontend}"
ENV_FILE="$FRONTEND_DIR/.env"
ENV_TEMPLATE="$FRONTEND_DIR/.env.example"
BACKEND_DIR="${BACKEND_DIR:-$ROOT_DIR/backend}"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/.venv}"
VENV_PY="$VENV_DIR/bin/python"
VENV_PIP="$VENV_DIR/bin/pip"
MODELS_DIR="${KOKORO_MODELS_DIR:-$ROOT_DIR/models}"
# Prefer shared models from the original repo if available (avoids re-downloads in worktrees)
SHARED_MODELS_CANDIDATE="$(cd "$ROOT_DIR/.." && pwd)/kokoro_twvv/models"
if [[ -z "${KOKORO_MODELS_DIR:-}" && -d "$SHARED_MODELS_CANDIDATE" ]]; then
  MODELS_DIR="$SHARED_MODELS_CANDIDATE"
fi
MODEL_URL="${KOKORO_MODEL_URL:-https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx}"
VOICES_URL="${KOKORO_VOICES_URL:-https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin}"
MODEL_PATH_DEFAULT="$MODELS_DIR/kokoro-v1.0.onnx"
VOICES_PATH_DEFAULT="$MODELS_DIR/voices-v1.0.bin"
DEPS_STAMP="${DEPS_STAMP:-$ROOT_DIR/.deps_installed}"
AUTO_DOWNLOAD="${KOKORO_AUTO_DOWNLOAD:-1}"
MODE="${KOKORO_MODE:-dev}"
SKIP_BACKEND_FLAG="${SKIP_BACKEND:-0}"
TAKE_OVER_FLAG="${TAKE_OVER:-0}"
BACKEND_API_PREFIX="${API_PREFIX:-${VITE_API_PREFIX:-api}}"
DIST_INDEX="$FRONTEND_DIR/dist/index.html"
TTS_HUB_ROOT="${TTS_HUB_ROOT:-$(cd "$ROOT_DIR/.." && pwd)}"
XTTS_ROOT="${XTTS_ROOT:-$TTS_HUB_ROOT/XTTS}"
XTTS_SERVICE_DIR="${XTTS_SERVICE_DIR:-$XTTS_ROOT/tts-service}"
XTTS_VENV="${XTTS_VENV:-$XTTS_SERVICE_DIR/.venv}"
OPENVOICE_ROOT="${OPENVOICE_ROOT:-$TTS_HUB_ROOT/openvoice}"
OPENVOICE_VENV="${OPENVOICE_VENV:-$OPENVOICE_ROOT/.venv}"
CHATTT_ROOT="${CHATTT_ROOT:-$TTS_HUB_ROOT/chattts}"
CHATTT_VENV="${CHATTT_VENV:-$CHATTT_ROOT/.venv}"

# Interactive options (can be skipped with SKIP_ASK=1)
SKIP_ASK="${SKIP_ASK:-0}"

# WireGuard integration (optional)
# WG_MODE: off | auto | bind-wg | bind-all
#  - auto: detect WG IP; bind to 0.0.0.0 and advertise WG IP as public host
#  - bind-wg: bind only to WG IP (VPN-only)
#  - bind-all: bind 0.0.0.0 (LAN + VPN)
WG_MODE="${WG_MODE:-auto}"
# You may explicitly set PUBLIC_HOST to override what peers should use to reach this host.
PUBLIC_HOST="${PUBLIC_HOST:-}"

log() {
  printf '[Kokoro SPA] %s\n' "$*"
}

yesno_default_no() {
  local prompt="$1"; local ans
  read -r -p "$prompt [y/N] " ans || ans=""
  case "$(printf '%s' "$ans" | tr '[:upper:]' '[:lower:]')" in
    y|yes) return 0 ;;
    *) return 1 ;;
  esac
}

# Prompt that auto-selects 'yes' after a timeout (default 3s)
yesno_auto_yes_after() {
  local prompt="$1"; local timeout="${2:-3}"; local ans
  # Use timed read; do not exit on timeout even with set -e
  if ! read -t "$timeout" -r -p "$prompt [y/N] (auto Y in ${timeout}s) " ans; then
    ans=""
    echo  # newline after timed prompt
  fi
  # No response → auto-yes
  if [[ -z "$ans" ]]; then
    return 0
  fi
  case "$(printf '%s' "$ans" | tr '[:upper:]' '[:lower:]')" in
    y|yes) return 0 ;;
    *) return 1 ;;
  esac
}

open_in_browser() {
  local url="$1"
  if command -v open >/dev/null 2>&1; then
    log "Opening $url in default browser"
    (sleep 2 && open "$url") >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then
    log "Opening $url in default browser"
    (sleep 2 && xdg-open "$url") >/dev/null 2>&1 &
  else
    log "Could not find a browser launcher; open $url manually."
  fi
}

if command -v npm >/dev/null 2>&1; then
  HAS_NPM=1
else
  HAS_NPM=0
fi

# Networking helpers
port_in_use() {
  local p="$1"
  lsof -ti TCP:"$p" >/dev/null 2>&1
}

pick_free_port() {
  local start="$1"; local limit="${2:-10}"; local p="$start"; local i=0
  while port_in_use "$p" && [[ $i -lt $limit ]]; do
    p=$((p+1)); i=$((i+1))
  done
  echo "$p"
}

# Try to detect a WireGuard/utun IPv4 address (macOS WireGuard typically uses utunX)
detect_wireguard_ip() {
  # Prefer wg* interfaces if present, else utun*/tun*
  if command -v ifconfig >/dev/null 2>&1; then
    # Scan wg*, utun*, tun* blocks for the first 'inet' address
    ifconfig 2>/dev/null \
      | sed -n '/^wg[0-9]/,/^$/p; /^utun[0-9]/,/^$/p; /^tun[0-9]/,/^$/p' \
      | awk '$1 == "inet" {print $2; exit}'
  fi
}

# Try to detect a primary LAN IPv4 address (useful for status hints)
detect_lan_ip() {
  # macOS: prefer Wi‑Fi en0, then Ethernet en1
  if command -v ipconfig >/dev/null 2>&1; then
    ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true
    return
  fi
  # Fallback: parse ifconfig for en* devices
  if command -v ifconfig >/dev/null 2>&1; then
    ifconfig 2>/dev/null | sed -n '/^en[0-9]/,/^$/p' | awk '$1 == "inet" && $2 !~ /^127\./ {print $2; exit}'
  fi
}

MODE_LOWER=$(printf '%s' "$MODE" | tr '[:upper:]' '[:lower:]')

NEEDS_NPM=1
if [[ "$MODE_LOWER" == "prod" && -f "$DIST_INDEX" ]]; then
  NEEDS_NPM=0
fi

if [[ "$HAS_NPM" -eq 0 ]]; then
  if [[ "$NEEDS_NPM" -eq 1 ]]; then
    log "Node.js/npm not found on PATH. Install Node.js (https://nodejs.org/) or provide a pre-built frontend/dist bundle."
    exit 1
  else
    log "npm not found; using existing frontend/dist bundle in prod mode."
  fi
fi

ensure_python_venv() {
  local name="$1"
  local root_dir="$2"
  local venv_dir="$3"
  local requirements_file="$4"
  local python_bin="${5:-$PYTHON}"

  if [[ ! -d "$root_dir" ]]; then
    log "$name root not found at $root_dir – skipping automatic setup."
    return 0
  fi

  if ! command -v "$python_bin" >/dev/null 2>&1; then
    python_bin="$PYTHON"
  fi

  local venv_python="$venv_dir/bin/python"
  local venv_pip="$venv_dir/bin/pip"

  local recreate=0
  if [[ ! -x "$venv_python" || ! -x "$venv_pip" ]]; then
    recreate=1
  else
    if ! "$venv_python" -c "import sys" >/dev/null 2>&1; then
      recreate=1
    fi
    if [[ $recreate -eq 0 ]]; then
      if ! "$venv_pip" --version >/dev/null 2>&1; then
        recreate=1
      fi
    fi
  fi

  if [[ $recreate -eq 1 ]]; then
    if [[ -d "$venv_dir" ]]; then
      log "Recreating $name virtual environment at $venv_dir"
      rm -rf "$venv_dir"
    else
      log "Creating $name virtual environment at $venv_dir"
    fi
    mkdir -p "$venv_dir"
    "$python_bin" -m venv "$venv_dir"
    venv_python="$venv_dir/bin/python"
    venv_pip="$venv_dir/bin/pip"
  fi

  if [[ ! -x "$venv_python" || ! -x "$venv_pip" ]]; then
    log "$name virtualenv missing executables at $venv_dir – manual intervention may be required."
    return 1
  fi

  if [[ -n "$requirements_file" ]]; then
    if [[ -f "$requirements_file" ]]; then
      local deps_stamp="$venv_dir/.deps_stamp"
      if [[ ! -f "$deps_stamp" || "$requirements_file" -nt "$deps_stamp" ]]; then
        log "Installing $name dependencies from $(basename "$requirements_file")"
        "$venv_python" -m pip install --upgrade pip
        "$venv_python" -m pip install -r "$requirements_file"
        touch "$deps_stamp"
      else
        log "$name dependencies already present."
      fi
    else
      log "$name requirements file not found at $requirements_file – skipping dependency install."
    fi
  fi
}

PYTHON="python3"
if command -v python3.11 >/dev/null 2>&1; then
  PYTHON="python3.11"
fi

if [[ ! -d "$FRONTEND_DIR" ]]; then
  log "frontend/ directory not found. Re-clone or ensure the project structure is intact."
  exit 1
fi

if [[ ! -f "$ENV_FILE" && -f "$ENV_TEMPLATE" ]]; then
  cp "$ENV_TEMPLATE" "$ENV_FILE"
  log "Created frontend/.env from .env.example. Adjust values if you need a custom API origin."
fi

if [[ ! -d "$MODELS_DIR" ]]; then
  mkdir -p "$MODELS_DIR"
fi

download_file() {
  local url="$1"
  local target="$2"
  if [[ -f "$target" ]]; then
    log "Found $(basename "$target")"
    return 0
  fi
  if command -v curl >/dev/null 2>&1; then
    log "Downloading $(basename "$target")..."
    curl -L --fail -o "$target" "$url"
  elif command -v wget >/dev/null 2>&1; then
    log "Downloading $(basename "$target")..."
    wget -O "$target" "$url"
  else
    log "Neither curl nor wget is available; cannot download required models."
    exit 1
  fi
}

should_auto_download() {
  local value
  value=$(printf '%s' "$AUTO_DOWNLOAD" | tr '[:upper:]' '[:lower:]')
  case "$value" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

health_check_models() {
  local model_path="${KOKORO_MODEL:-$MODEL_PATH_DEFAULT}"
  local voices_path="${KOKORO_VOICES:-$VOICES_PATH_DEFAULT}"
  local using_shared="no"
  if [[ "$MODELS_DIR" == "$SHARED_MODELS_CANDIDATE" ]]; then
    using_shared="yes"
    log "Using shared models directory: $MODELS_DIR"
  else
    log "Using models directory: $MODELS_DIR"
  fi

  local exists_any=0
  if [[ -f "$model_path" ]]; then
    local sz; sz=$(du -h "$model_path" 2>/dev/null | awk '{print $1}')
    log " - Model: $(basename "$model_path") present ($sz)"
    exists_any=1
  else
    log " - Model: MISSING at $model_path"
  fi
  if [[ -f "$voices_path" ]]; then
    local szv; szv=$(du -h "$voices_path" 2>/dev/null | awk '{print $1}')
    log " - Voices: $(basename "$voices_path") present ($szv)"
    exists_any=1
  else
    log " - Voices: MISSING at $voices_path"
  fi

  if [[ $exists_any -eq 0 ]]; then
    if ! should_auto_download; then
      if [[ "$using_shared" == "yes" ]]; then
        log "Shared models not found and auto-download is disabled."
        log "Tip: run the launcher in ../kokoro_twvv first to download assets, or set KOKORO_MODELS_DIR/.env to a valid path."
      else
        log "Models not found and auto-download is disabled. Set KOKORO_MODELS_DIR or enable KOKORO_AUTO_DOWNLOAD=1."
      fi
    else
      log "Assets missing; auto-download is enabled and will attempt download."
    fi
  fi
}

ensure_asset() {
  local url="$1"
  local target="$2"
  local label="$3"
  if [[ -f "$target" ]]; then
    log "Found $(basename "$target")"
    return 0
  fi
  if should_auto_download; then
    download_file "$url" "$target"
  else
    log "$label missing and auto-download disabled (KOKORO_AUTO_DOWNLOAD=$AUTO_DOWNLOAD)."
    log "Provide the file manually or enable auto-download."
    exit 1
  fi
}

health_check_models
ensure_asset "$MODEL_URL" "$MODEL_PATH_DEFAULT" "Model"
ensure_asset "$VOICES_URL" "$VOICES_PATH_DEFAULT" "Voice bank"

if [[ ! -x "$VENV_PY" ]]; then
  log "Creating Python virtual environment with $PYTHON..."
  "$PYTHON" -m venv "$VENV_DIR"
fi

if [[ ! -x "$VENV_PIP" ]]; then
  log "Virtualenv pip missing. Something went wrong during venv creation."
  exit 1
fi

if [[ ! -f "$DEPS_STAMP" || "$BACKEND_DIR/requirements.txt" -nt "$DEPS_STAMP" ]]; then
  log "Installing backend dependencies..."
  "$VENV_PIP" install --upgrade pip
  "$VENV_PIP" install -r "$BACKEND_DIR/requirements.txt"
  touch "$DEPS_STAMP"
else
  log "Backend dependencies already present."
fi

if [[ "$HAS_NPM" -eq 1 ]]; then
  if [[ ! -d "$FRONTEND_DIR/node_modules" || "$FRONTEND_DIR/package.json" -nt "$DEPS_STAMP" || "$FRONTEND_DIR/package-lock.json" -nt "$DEPS_STAMP" ]]; then
    log "Installing frontend dependencies (npm install)…"
    (cd "$FRONTEND_DIR" && npm install)
    touch "$DEPS_STAMP"
  else
    log "Frontend dependencies already present (frontend/node_modules)."
  fi
else
  log "Skipping frontend dependency install (npm unavailable)."
fi

ensure_python_venv "XTTS" "$XTTS_SERVICE_DIR" "$XTTS_VENV" "$XTTS_SERVICE_DIR/requirements.txt"
ensure_python_venv "OpenVoice" "$OPENVOICE_ROOT" "$OPENVOICE_VENV" "$OPENVOICE_ROOT/requirements.txt"
ensure_python_venv "ChatTTS" "$CHATTT_ROOT" "$CHATTT_VENV" "$CHATTT_ROOT/requirements.txt"

export KOKORO_MODEL="${KOKORO_MODEL:-$MODEL_PATH_DEFAULT}"
export KOKORO_VOICES="${KOKORO_VOICES:-$VOICES_PATH_DEFAULT}"
export KOKORO_OUT="${KOKORO_OUT:-$ROOT_DIR/out}"
export API_PREFIX="$BACKEND_API_PREFIX"
# STT/Alignment toggles (prompt if not set and interactive)
if [[ "$SKIP_ASK" != "1" ]]; then
  if [[ -z "${WHISPERX_ENABLE:-}" ]]; then
    if yesno_auto_yes_after "Enable WhisperX alignment for tighter word timings? (slower, requires torch/whisperx)" 1; then
      export WHISPERX_ENABLE=1
    else
      export WHISPERX_ENABLE=0
    fi
  fi
  if [[ "${WHISPERX_ENABLE:-0}" =~ ^(1|true|yes)$ ]]; then
    if [[ -z "${WHISPERX_DEVICE:-}" ]]; then
      # Default device: mps on macOS, else cpu
      case "$OSTYPE" in
        darwin*) export WHISPERX_DEVICE="mps" ;;
        *)       export WHISPERX_DEVICE="cpu" ;;
      esac
      echo "[Kokoro SPA] WhisperX device not set; using $WHISPERX_DEVICE (set WHISPERX_DEVICE to override)."
    fi
  fi
fi
# Allow stub STT unless explicitly disabled
export ALLOW_STUB_STT="${ALLOW_STUB_STT:-1}"
# Export host hints for backend meta endpoint
export PUBLIC_HOST
export LAN_IP
export XTTS_ROOT
export XTTS_SERVICE_DIR
export XTTS_PYTHON="${XTTS_PYTHON:-$XTTS_VENV/bin/python}"
export XTTS_VOICE_DIR="${XTTS_VOICE_DIR:-$XTTS_SERVICE_DIR/voices}"
export OPENVOICE_ROOT
export OPENVOICE_PYTHON="${OPENVOICE_PYTHON:-$OPENVOICE_VENV/bin/python}"
export OPENVOICE_CKPT_ROOT="${OPENVOICE_CKPT_ROOT:-$OPENVOICE_ROOT/checkpoints}"
export CHATTT_ROOT
export CHATTT_PYTHON="${CHATTT_PYTHON:-$CHATTT_VENV/bin/python}"
export CHATTT_PRESET_DIR="${CHATTT_PRESET_DIR:-$CHATTT_ROOT/presets}"
mkdir -p "$KOKORO_OUT"
if [[ -d "$CHATTT_ROOT" ]]; then
  mkdir -p "$CHATTT_PRESET_DIR"
fi

XTTS_SERVER_LOG="${XTTS_SERVER_LOG:-/tmp/kokoro_xtts_server.log}"
XTTS_SERVER_HOST="${XTTS_SERVER_HOST:-127.0.0.1}"
XTTS_SERVER_PORT="${XTTS_SERVER_PORT:-3333}"
BACKEND_MODE="unknown"
XTTS_MODE="skipped"

should_skip_backend() {
  local v
  v=$(printf '%s' "$SKIP_BACKEND_FLAG" | tr '[:upper:]' '[:lower:]')
  case "$v" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

should_take_over() {
  local v
  v=$(printf '%s' "$TAKE_OVER_FLAG" | tr '[:upper:]' '[:lower:]')
  case "$v" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

if ! should_skip_backend && [[ -x "$XTTS_PYTHON" && -f "$XTTS_SERVICE_DIR/run_server.py" ]]; then
  export XTTS_SERVER_URL="${XTTS_SERVER_URL:-http://$XTTS_SERVER_HOST:$XTTS_SERVER_PORT}"
  existing_xtts_pids=$(lsof -ti TCP:$XTTS_SERVER_PORT 2>/dev/null || true)
  if [[ -n "$existing_xtts_pids" ]]; then
    if should_take_over; then
      log "Taking over XTTS port $XTTS_SERVER_PORT (killing $existing_xtts_pids)"
      echo "$existing_xtts_pids" | xargs kill 2>/dev/null || true
      sleep 1
    else
      log "XTTS server detected on $XTTS_SERVER_PORT ($existing_xtts_pids); reusing."
      XTTS_SERVER_PID=""
      XTTS_MODE="reused"
    fi
  fi
  if [[ -z "$existing_xtts_pids" ]] || should_take_over; then
    log "Starting XTTS server on $XTTS_SERVER_URL"
    (
      cd "$XTTS_SERVICE_DIR"
      "$XTTS_PYTHON" run_server.py
    ) >>"$XTTS_SERVER_LOG" 2>&1 &
    XTTS_SERVER_PID=$!
    log "XTTS server PID $XTTS_SERVER_PID (logs -> $XTTS_SERVER_LOG)"
    XTTS_MODE="started"
  fi
else
  log "XTTS server script not found – falling back to CLI mode."
fi

# Host/port for Flask backend
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-7860}"

log "Launcher mode: ${MODE_LOWER}"

# WireGuard-aware host selection
if [[ "$WG_MODE" != "off" && -z "$PUBLIC_HOST" ]]; then
  WG_IP="$(detect_wireguard_ip || true)"
  if [[ -n "$WG_IP" ]]; then
    PUBLIC_HOST="$WG_IP"
    case "$(printf '%s' "$WG_MODE" | tr '[:upper:]' '[:lower:]')" in
      bind-wg)
        BACKEND_HOST="$WG_IP"   # bind only on WG IP
        : "${VITE_HOST:=0.0.0.0}" # dev server binds all; public URL uses PUBLIC_HOST
        ;;
      auto|bind-all|*)
        BACKEND_HOST="0.0.0.0"  # bind all interfaces (LAN + WG)
        : "${VITE_HOST:=0.0.0.0}"
        ;;
    esac
    log "WireGuard IP detected: $WG_IP (WG_MODE=$WG_MODE)"
  fi
fi

# Detect LAN IP for status hints (does not affect binding)
LAN_IP="${LAN_IP:-$(detect_lan_ip || true)}"

if [[ "$MODE_LOWER" == "prod" ]]; then
  if [[ "$HAS_NPM" -eq 1 ]]; then
    log "Building frontend for production (npm run build)…"
    (cd "$FRONTEND_DIR" && npm run build)
  elif [[ ! -f "$DIST_INDEX" ]]; then
    log "Missing frontend/dist bundle and npm is unavailable."
    exit 1
  else
    log "Using existing frontend/dist bundle (npm unavailable)."
  fi
fi

trap '[[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null; [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null; [[ -n "${XTTS_SERVER_PID:-}" ]] && kill "$XTTS_SERVER_PID" 2>/dev/null' EXIT

probe_backend() {
  # best-effort liveness check for Flask: /api/meta then /health
  if command -v curl >/dev/null 2>&1; then
    curl -sS --max-time 1 "http://127.0.0.1:$BACKEND_PORT/${BACKEND_API_PREFIX}/meta" >/dev/null 2>&1 && return 0
    curl -sS --max-time 1 "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1 && return 0
  fi
  return 1
}

existing_backend_pids=$(lsof -ti TCP:$BACKEND_PORT 2>/dev/null || true)
if [[ -n "$existing_backend_pids" ]]; then
  if should_take_over; then
    log "TAKE_OVER=1 → restarting backend (killing $existing_backend_pids)"
    echo "$existing_backend_pids" | xargs kill 2>/dev/null || true
    sleep 1
  else
    if probe_backend; then
      log "Backend detected on $BACKEND_PORT ($existing_backend_pids); reusing (auto SKIP_BACKEND)."
      SKIP_BACKEND_FLAG=1
    else
      log "Backend detected on $BACKEND_PORT but not responding; restarting (killing $existing_backend_pids)"
      echo "$existing_backend_pids" | xargs kill 2>/dev/null || true
      sleep 1
    fi
  fi
fi

if ! should_skip_backend; then
  log "Starting Flask backend on http://$BACKEND_HOST:$BACKEND_PORT"
  BACKEND_HOST="$BACKEND_HOST" BACKEND_PORT="$BACKEND_PORT" "$VENV_PY" "$BACKEND_DIR/app.py" &
  BACKEND_PID=$!

  sleep 2 || true
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    log "Backend failed to start. Check the output above for details."
    wait "$BACKEND_PID"
    exit 1
  fi
  BACKEND_MODE="started"
else
  log "SKIP_BACKEND=1 set – using existing backend at http://$BACKEND_HOST:$BACKEND_PORT"
  BACKEND_MODE="reused"
fi

  if [[ "$MODE_LOWER" == "prod" ]]; then
  log "Production mode active. Serving built assets via Flask."
  if should_skip_backend; then
    log "Cannot run UI-only in prod; backend is required. Start backend in another session or run dev mode."
    exit 1
  else
    # Prefer PUBLIC_HOST for URLs shown to peers (avoid 0.0.0.0)
    OPEN_HOST="${PUBLIC_HOST:-$BACKEND_HOST}"
    # Helpful status URLs
    log "URLs → Local: http://127.0.0.1:$BACKEND_PORT  LAN: ${LAN_IP:+http://$LAN_IP:$BACKEND_PORT }WG: ${PUBLIC_HOST:+http://$PUBLIC_HOST:$BACKEND_PORT }"
    log "API  → http://127.0.0.1:$BACKEND_PORT/$BACKEND_API_PREFIX  ${LAN_IP:+http://$LAN_IP:$BACKEND_PORT/$BACKEND_API_PREFIX }${PUBLIC_HOST:+http://$PUBLIC_HOST:$BACKEND_PORT/$BACKEND_API_PREFIX }"
    if [[ -n "$PUBLIC_HOST" ]]; then
      log "Tip: From Docker on a peer — docker run --rm --network host -e TTSHUB_API_BASE=http://$PUBLIC_HOST:$BACKEND_PORT/$BACKEND_API_PREFIX curlimages/curl:8.10.1 curl -sS \"\$TTSHUB_API_BASE/meta\""
    fi
    open_in_browser "http://$OPEN_HOST:$BACKEND_PORT"
    wait "$BACKEND_PID"
    exit $?
  fi
fi

DEV_PORT="${VITE_PORT:-5175}"
DEV_HOST="${VITE_HOST:-127.0.0.1}"
ORIG_DEV_PORT="$DEV_PORT"
DEV_PORT="$(pick_free_port "$DEV_PORT" 10)"
DEV_URL="http://$DEV_HOST:$DEV_PORT"
if [[ "$DEV_PORT" != "$ORIG_DEV_PORT" ]]; then
  log "Dev port $ORIG_DEV_PORT busy; using $DEV_PORT"
fi

log "Status summary: backend=$BACKEND_MODE, xtts=$XTTS_MODE, ui=$DEV_HOST:$DEV_PORT, mode=$MODE_LOWER"
if [[ "${WHISPERX_ENABLE:-0}" =~ ^(1|true|yes)$ ]]; then
  log "STT: faster-whisper enabled; WhisperX alignment ENABLED (device=${WHISPERX_DEVICE:-auto})."
else
  log "STT: faster-whisper enabled; WhisperX alignment DISABLED."
fi

log "Starting Vite dev server on $DEV_URL"

cd "$FRONTEND_DIR"
# Use PUBLIC_HOST for the API base when available (ensures remote peers can reach it)
VITE_API_BASE_URL="http://${PUBLIC_HOST:-$BACKEND_HOST}:$BACKEND_PORT" \
VITE_API_PREFIX="${VITE_API_PREFIX:-$BACKEND_API_PREFIX}" \
npm run dev -- --host "$DEV_HOST" --port "$DEV_PORT" &
FRONTEND_PID=$!

# Open a more useful URL for peers when PUBLIC_HOST is known
OPEN_DEV_HOST="${PUBLIC_HOST:-$DEV_HOST}"
log "URLs → UI:  http://127.0.0.1:$DEV_PORT  ${LAN_IP:+http://$LAN_IP:$DEV_PORT }${PUBLIC_HOST:+http://$OPEN_DEV_HOST:$DEV_PORT (WG) }"
log "API: http://127.0.0.1:$BACKEND_PORT/$BACKEND_API_PREFIX  ${LAN_IP:+http://$LAN_IP:$BACKEND_PORT/$BACKEND_API_PREFIX }${PUBLIC_HOST:+http://$PUBLIC_HOST:$BACKEND_PORT/$BACKEND_API_PREFIX }"
if [[ -n "$PUBLIC_HOST" ]]; then
  log "Tip: From Docker on a peer — docker run --rm --network host -e TTSHUB_API_BASE=http://$PUBLIC_HOST:$BACKEND_PORT/$BACKEND_API_PREFIX curlimages/curl:8.10.1 curl -sS \"\$TTSHUB_API_BASE/meta\""
fi
open_in_browser "http://$OPEN_DEV_HOST:$DEV_PORT"

wait "$FRONTEND_PID"
