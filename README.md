# Kokoro Playground TWVV

Modern Kokoro text-to-speech playground built with a Flask backend and a React + Vite single-page app. This branch consolidates the feature set of the original Kokoro project with the maintainable tooling introduced in the TWVV experiments.

- **Backend** — Flask service exposing `/api` endpoints for synthesis, auditions, voice metadata, and health checks.
- **Frontend** — React + TypeScript SPA with React Query, announcer-aware auditions, grouped voice browser, and WaveSurfer playback.
- **Launcher** — POSIX shell script (`Start Kokoro Playground (XTTS Server).command`) that provisions dependencies, downloads Kokoro models, and runs both backend and frontend (or production-only Flask hosting).

---

## Prerequisites

- macOS or Linux shell (launcher uses POSIX utilities).
- Python 3.10+ (Python 3.11 preferred).
- Node.js 18+ (for Vite dev server / builds).
- ~350 MB free disk for Kokoro model + voice bank.

---

## Quick Start

### 1. Configure Environment

Optional: duplicate `.env.example` to `.env` and adjust values:

```bash
cp .env.example .env
```

Key toggles:

- `KOKORO_AUTO_DOWNLOAD=1` — auto-download Kokoro model and voices if missing.
- `KOKORO_MODE=dev|prod` — dev starts Vite, prod builds the SPA and serves via Flask only.
- `KOKORO_MODEL` / `KOKORO_VOICES` — override default paths if you already have the assets.
- `API_PREFIX` / `VITE_API_PREFIX` — customise the `/api` prefix used by both backend and SPA.

### 2. Launch (Dev Mode)

```bash
./Start\ Kokoro\ Playground\ (XTTS\ Server).command
```

The script will:

1. Source `.env` (if present).
2. Create/upgrade `.venv` and install backend dependencies on demand.
3. Install frontend dependencies on first run.
4. Download Kokoro assets when `KOKORO_AUTO_DOWNLOAD=1` and files are missing.
5. Start the Flask API on `http://127.0.0.1:7860`.
6. Start the Vite dev server on `http://127.0.0.1:5175`.

Leave the terminal window open—closing it stops both services.

### 3. Production Mode

```bash
KOKORO_MODE=prod ./Start\ Kokoro\ Playground\ (XTTS\ Server).command
```

Production mode builds `frontend/dist/`, skips Vite, and serves the static bundle directly via Flask. Visit `http://127.0.0.1:7860` to use the UI.

### Manual Workflow (Optional)

```bash
# Backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
python backend/app.py

# Frontend
cd frontend
npm install
npm run dev
```

---

## Configuration Reference (`.env`)

| Variable | Description | Default |
| --- | --- | --- |
| `BACKEND_HOST` / `BACKEND_PORT` | Flask bind address/port. | `127.0.0.1` / `7860` |
| `KOKORO_AUTO_DOWNLOAD` | `1` to auto-download models if missing, `0` to require manual placement. | `1` |
| `KOKORO_MODEL_URL` / `KOKORO_VOICES_URL` | Download sources for model & voices. | Official Kokoro release URLs |
| `KOKORO_MODEL` / `KOKORO_VOICES` | Absolute or relative paths to assets (overrides defaults). | `./models/...` |
| `KOKORO_MODE` | `dev` (Flask + Vite) or `prod` (Flask with built SPA). | `dev` |
| `API_PREFIX` | Prefix for backend API routes (without slashes). | `api` |
| `VITE_HOST` / `VITE_PORT` | Vite dev server host & port. | `127.0.0.1` / `5175` |
| `VITE_API_BASE_URL` | Optional full URL the SPA should use (defaults to same-origin). | – |
| `VITE_API_PREFIX` | SPA-side API prefix (defaults to `API_PREFIX`). | `api` |
| `OLLAMA_URL` / `OLLAMA_MODEL` | Configure Ollama integration for random text prompts. | `http://127.0.0.1:11434` / `phi3:latest` |

For additional frontend-specific variables see `frontend/.env.example`.

---

### WireGuard Mode

If you use WireGuard (or similar), the launcher can auto-detect your VPN IP and print peer‑reachable URLs. It can bind to all interfaces (LAN + VPN) or VPN‑only.

- Quick start: `WG_MODE=auto ./Start\ Kokoro\ Playground\ (XTTS\ Server).command`
- Details: see `docs/WIREGUARD_MODE.md`.

#### Ports & Networking

- Hub (Flask API): `7860`
  - Peers/bots should always call the hub on this port, e.g. `http://<WG_IP_OF_MAC>:7860/api/...`.
- Dev UI (Vite): `5175`
  - Local development only (the UI talks to the hub on 7860).
- Draw Things (local HTTP API): `7861` (recommended)
  - Runs only on the Mac at `127.0.0.1:7861`. The hub proxies it to peers via `/api/drawthings/*`.

Tip: The launcher prints a one‑line Draw Things status: `Draw Things: online at http://127.0.0.1:7861` when reachable.

---

### Ollama Proxy (LLM over the hub)

The hub exposes your local Ollama to peers (NAS, bots) via the same API base on port 7860. Set `OLLAMA_URL` (default `http://127.0.0.1:11434`).

Endpoints (non‑stream and SSE):
- `GET /api/ollama/tags` — list installed models
- `POST /api/ollama/generate` — body `{ model, prompt, stream?: boolean }`
- `POST /api/ollama/chat` — body `{ model, messages[], stream?: boolean }`
- `POST /api/ollama/pull` — body `{ model, stream?: boolean }` (SSE progress by default)
- `GET /api/ollama/ps` — runtime status
- `GET|POST /api/ollama/show` — model details (`?model=name`)
- `GET|POST /api/ollama/delete` — remove a model (`?model=name`); falls back to CLI when needed

Notes
- Streaming mode returns Server‑Sent Events (`text/event-stream`) and emits an immediate `{"status":"starting"}` event for liveness.
- Delete normalizes missing models to 200: `{"status":"deleted","note":"already missing"}`.
- See `API_ROUTES.md` for payload shapes.

Quick tests (peer)
```
export TTSHUB_API_BASE=http://<WG_IP_OF_MAC>:7860/api
curl -sS "$TTSHUB_API_BASE/ollama/tags" | jq
curl -N -sS -X POST "$TTSHUB_API_BASE/ollama/pull" -H 'Content-Type: application/json' -d '{"model":"tinyllama:latest","stream":true}'
curl -sS -X POST "$TTSHUB_API_BASE/ollama/generate" -H 'Content-Type: application/json' -d '{"model":"phi3:latest","prompt":"Say hello","stream":false}' | jq
```

---

### Built-in API Panel

At the bottom of the UI there’s a collapsible “API & CLI” section. It shows:
- Current API base used by the UI
- Copyable URLs for Local, LAN, and WireGuard (when detected)
- Quick curl examples and the Python CLI reminder

This updates automatically based on the launcher’s network hints and backend `/api/meta` response.

---

## API Endpoints

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/meta` | GET | Runtime info: API prefix, port, model/voice presence, random-text categories, bundle status, Ollama availability. |
| `/api/health` | GET | Basic health check used by the launcher. |
| `/api/voices` | GET | Flat list of voice profiles with locale metadata. |
| `/api/voices_grouped` | GET | Accent-aware voice buckets with flag metadata for the selector chips. |
| `/api/random_text` | GET | Returns sample text plus category info; calls Ollama when available. |
| `/api/ollama_models` | GET | Lists cached Ollama models; 503 when Ollama offline. |
| `/api/synthesise` (`/api/synthesize`) | POST | Generate a single clip. Body: `{ text, voice, speed, language, trimSilence }`. |
| `/api/audition` | POST | Stitch multi-voice audition with optional announcer. Body includes `voices[]`, `announcer`, `gapSeconds`. |
| `/audio/<filename>` | GET | Stream generated WAV files. |

The backend also serves `frontend/dist/` assets when Vite is not running (production mode).

---

## Frontend Highlights

- Announcer-aware audition builder with template strings and gap control.
- Voice browser with accent/flag filters (powered by `/api/voices_grouped`), quick search, and multi-select.
- Random text helpers with automatic category updates from `/api/meta`.
- Media Editor (beta): transcript-based replace with XTTS. See `docs/MEDIA_EDITING_WITH_XTTS.md`.

### What’s New (UI v2 revamp)

- Segmented modes: Script | Engine | Voice | Clips with active styling, letter/digit hotkeys, and warning highlight only in Voice when none selected.
- Engine selection cards with strengths + overview; accessible off-screen select remains for keyboard/screen-reader parity.
- Quick settings gear: Auto preview on hover and Auto open Clips on completion (both on by default, persisted in localStorage).
- Queue → Clips flow: Queue tab shows only active items with live count; auto-switches to Clips when queue becomes empty and results exist; newest clip briefly highlights.
- Voice quick menu: caret on the Voice segment opens Favorites (up to 5) + Recent (up to 5); selecting a voice returns to Script.
- Script header includes an AI Assist pill (Ready/Offline) reflecting backend Ollama availability.

### Keyboard Shortcuts

- 1 = Script, 2 = Engine, 3 = Voice, 4 = Clips
- G = Create clip, V = Voices, R = Clips, S = Settings, Shift+/? = AI Assist
- Shortcuts are ignored while typing in inputs/textarea (we check editable targets).

### “Create a clip” Flow

- Top-bar primary CTA is always rendered; it is disabled until preconditions are met: non-empty text, at least one voice selected, and engine ready.
- Clicking CTA enqueues immediately and opens Queue; when finished, it auto-switches to Clips (subject to the “Auto open Clips” toggle).
- One‑column layout: the main panel shows one primary column; segments map directly to the top bar chips (Script → Text, Engine → Controls, Voice → Selector, Clips → Drawer/View).

### Quick Voices

- The Voice segment chip includes a caret when Favorites or Recent exist.
- The quick menu shows up to 5 Favorites and up to 5 Recent voices; selecting a voice sets it and returns to Script for a fast generate loop.

### Engine Notes

- Kokoro (ONNX)
  - Local, offline engine with fast, natural multi‑speaker voices. Great defaults; snappy on modern CPUs.
  - Assets: model and voices are provisioned by the launcher (or set `KOKORO_MODEL` / `KOKORO_VOICES`).
  - Works fully offline; ideal for quick iterations and testing.

- **XTTS v2** – the optional launcher `Start Kokoro Playground (XTTS Server).command` starts a persistent FastAPI server on port 3333 and exports `XTTS_SERVER_URL` so synthesise requests skip CLI warm-up. The script will stop any existing process bound to that port before launching a fresh server; logs stream to `/tmp/kokoro_xtts_server.log`.
- **ChatTTS** – presets are exposed as selectable voices (`chattts_preset_<id>`). Selecting multiple presets (or the random speaker) enables audition mode just like Kokoro/XTTS/OpenVoice; speaker/seed metadata is managed automatically, so no separate “speaker” dropdown is required.
- **OpenVoice** – the voice cards include a “Learn how to add custom references” modal and inline preview button. References live under `openvoice/resources/…` and are served via `/audio/openvoice/<path>`.
- **Auditions** – all engines now share the same audition pipeline. Per-voice overrides (styles, presets, seeds) propagate automatically when building a reel, and announcer segments are synthesised through the selected engine for consistent output.
- React Query for data fetching and cache synchronisation.
- WaveSurfer.js playback for generated clips, with persistent history and download links.
- LocalStorage persistence for script, voices, announcer, and playback preferences.

### Kokoro UI v2 (Phase 2) Additions

- Top context bar with engine, voice summary, clips, and quick actions.
- Queue + Clips drawer at the bottom with optimistic progress, cancel stub, and session persistence.
- Voice Browser 2.0: hover micro‑preview (when samples exist), favorites with a pinned row, facet chips (Language/Gender/Style) with counts and multi-select, plus a clear‑filters button.
- Script authoring SSML helpers (Pause, Emphasis, Pitch, Rate) with word/char/duration counters and basic SSML validation.
- Results: Waveform player and a mini waveform with Loop/Start/End controls and “Export selection” to WAV.
- Accessibility: ARIA roles for voice lists and queue items; labeled buttons; consistent focus outlines.

### UI v2 Revamp Additions (Hotkeys, Engine Cards, Clips Flow)

- Segmented modes promoted to first-class navigation with digit and letter hotkeys.
- Engine cards include per-engine strengths and overview blurbs; fallback select is retained off-screen for a11y.
- Quick settings adds hover preview and auto-open Clips toggles (both default on).
- Results “History” is renamed to “Clips” and the drawer auto-switches from Queue → Clips when the queue drains and results exist.
- Newest clip gets a brief highlight for quick visual confirmation.
- Top-bar CTA “Create clip” is the primary action for the one‑column layout.

---

## Repository Layout

```
backend/    Flask API and requirements
frontend/   React + Vite SPA
models/     Kokoro model and voice assets (auto-created)
out/        Generated WAV files
Start Kokoro Playground (XTTS Server).command  Launcher script (POSIX shell)
PROJECT_OVERVIEW.md              Architectural overview
```

---

## Verification

- `bash -n Start\ Kokoro\ Playground.command` — lint launcher syntax.
- `python3 -m py_compile backend/app.py` — sanity-check backend imports.
- `npm run lint` / `npm run build` in `frontend/` — ensure SPA builds cleanly.
- Launch via script (dev & prod) to confirm `/api/meta` and UI respond with grouped voices and announcer controls.

Enjoy the upgraded Kokoro Playground! Contributions via issues or pull requests are welcome.
  - Favorites as presets (UI + API)
    - Star a voice to save a Favorite with engine + voice + params (language, speed, trim; style for OpenVoice; seed for ChatTTS).
    - Favorites include optional notes for human context; import/export preserves notes.
    - Quick select (caret on the Voice chip) shows Favorites first with Edit/Delete/Manage actions.
    - Favorites section in Voices is collapsible and now uses a compact row layout with a quick param summary and notes preview.
    - Scripts can synthesize by Favorite: `POST /api/synthesise { text, favoriteSlug }` (aliases `favoriteId`, and existing `profileId/profileSlug` still work).

---

## XTTS Custom Voices

Create custom XTTS reference voices from local audio or a YouTube clip.

- Create (UI): Voice panel → “Create custom voice…”. Supports file upload or YouTube URL with optional start/end. The server normalizes audio and validates a short duration.
- Manage (UI): “Manage custom voices…” to edit Default Language, Gender, Accent, Tags, and Notes; inline quick‑edit for Gender/Accent is available on each XTTS card. A read‑only Source section shows the original filename or YouTube URL/title and the range used.
- API endpoints (see API_ROUTES.md for details):
  - `POST /api/xtts/custom_voice` (upload or YouTube)
  - `GET|PATCH|DELETE /api/xtts/custom_voice/:id`

Notes
- “Default Language” can auto‑apply to the session when a voice is selected (toggle in Settings).
- Accent is used for UI filtering/badges and isn’t sent to the engine; Language is what the engine uses.

## Favorites

- The API returns all favorites across engines; clients that want a curated subset (e.g., for a bot) should implement their own filtering.

### Draw Things (Stable Diffusion)

If you run Draw Things on the same Mac and enable its HTTP API (Settings → API Server → HTTP), the hub can proxy it for peers over WireGuard.

- Set `DRAWTHINGS_URL` (default `http://127.0.0.1:7859`).
- Call via the hub base (e.g., `http://<WG_IP>:7860/api/drawthings/txt2img`).
- Endpoints: `/drawthings/models`, `/drawthings/samplers`, `/drawthings/txt2img`, `/drawthings/img2img`.

Example:

```
export TTSHUB_API_BASE=http://<WG_IP_OF_MAC>:7860/api
curl -sS -X POST "$TTSHUB_API_BASE/drawthings/txt2img" -H 'content-type: application/json' \
  -d '{"prompt":"Sunlit watercolor fox","steps":20,"width":512,"height":512}' | jq '.images | length'
```

### YouTube Cookies (yt-dlp)

If YouTube imports intermittently 429 or are age/consent blocked, provide a cookies.txt for yt-dlp. See docs/YOUTUBE_COOKIES.md for steps and server envs (`YT_DLP_COOKIES_PATH`, `YT_DLP_EXTRACTOR_ARGS`).
