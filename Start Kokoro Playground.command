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

FRONTEND_DIR="${FRONTEND_DIR:-$ROOT_DIR/frontend}"
ENV_FILE="$FRONTEND_DIR/.env"
ENV_TEMPLATE="$FRONTEND_DIR/.env.example"
BACKEND_DIR="${BACKEND_DIR:-$ROOT_DIR/backend}"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/.venv}"
VENV_PY="$VENV_DIR/bin/python"
VENV_PIP="$VENV_DIR/bin/pip"
MODELS_DIR="${KOKORO_MODELS_DIR:-$ROOT_DIR/models}"
MODEL_URL="${KOKORO_MODEL_URL:-https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx}"
VOICES_URL="${KOKORO_VOICES_URL:-https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin}"
MODEL_PATH_DEFAULT="$MODELS_DIR/kokoro-v1.0.onnx"
VOICES_PATH_DEFAULT="$MODELS_DIR/voices-v1.0.bin"
DEPS_STAMP="${DEPS_STAMP:-$ROOT_DIR/.deps_installed}"
AUTO_DOWNLOAD="${KOKORO_AUTO_DOWNLOAD:-1}"
MODE="${KOKORO_MODE:-dev}"
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

if command -v npm >/dev/null 2>&1; then
  HAS_NPM=1
else
  HAS_NPM=0
fi

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

log() {
  printf '[Kokoro SPA] %s\n' "$*"
}

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
  case "${AUTO_DOWNLOAD,,}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
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

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-7860}"

log "Launcher mode: ${MODE_LOWER}"

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

trap '[[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null; [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null' EXIT

log "Starting Flask backend on http://$BACKEND_HOST:$BACKEND_PORT"
BACKEND_HOST="$BACKEND_HOST" BACKEND_PORT="$BACKEND_PORT" "$VENV_PY" "$BACKEND_DIR/app.py" &
BACKEND_PID=$!

sleep 2 || true
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
  log "Backend failed to start. Check the output above for details."
  wait "$BACKEND_PID"
  exit 1
fi

if [[ "$MODE_LOWER" == "prod" ]]; then
  log "Production mode active. Serving built assets via Flask."
  if command -v open >/dev/null 2>&1; then
    (sleep 2 && open "http://$BACKEND_HOST:$BACKEND_PORT") >/dev/null 2>&1 &
  fi
  wait "$BACKEND_PID"
  exit $?
fi

DEV_PORT="${VITE_PORT:-5173}"
DEV_HOST="${VITE_HOST:-127.0.0.1}"
DEV_URL="http://$DEV_HOST:$DEV_PORT"

log "Starting Vite dev server on $DEV_URL"

cd "$FRONTEND_DIR"
VITE_API_BASE_URL="http://$BACKEND_HOST:$BACKEND_PORT" \
VITE_API_PREFIX="${VITE_API_PREFIX:-$BACKEND_API_PREFIX}" \
npm run dev -- --host "$DEV_HOST" --port "$DEV_PORT" &
FRONTEND_PID=$!

wait "$FRONTEND_PID"
