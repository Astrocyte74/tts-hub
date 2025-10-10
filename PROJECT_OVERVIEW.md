# Kokoro Playground SPA Overview

This project delivers a refreshed Kokoro Playground experience by pairing a modern React/Vite single-page app with a lightweight Flask API. It wraps the [`kokoro-onnx`](https://pypi.org/project/kokoro-onnx/) model stack so you can generate clips locally, audition multiple voices, and experiment with prompt-driven copy from a single command.

## Key Components
- `backend/app.py` — Flask API that loads the ONNX model/voice bank, exposes `/api/meta`, `/api/voices`, `/api/voices_grouped`, `/api/random_text`, `/api/synthesise`, `/api/audition`, `/api/ollama_models`, and serves both generated audio and the production SPA bundle when Vite is not running.
- `backend/requirements.txt` — Python dependencies for the backend virtual environment.
- `frontend/` — Vite + React SPA that consumes the API. Includes voice browsing, announcer-aware auditions, random text helpers, and WaveSurfer-powered playback with React Query caching.
- `Start Kokoro Playground.command` — POSIX launcher. Sources `.env`, ensures the Python virtualenv exists, installs backend/frontend dependencies with a stamp file, optionally auto-downloads models into `./models/`, then starts the Flask API plus the Vite dev server (dev mode) or builds the SPA and serves it via Flask only (prod mode).
- `out/` — Default output folder for generated WAVs (git-ignored).

## Runtime Expectations
- Python 3.10+ (the launcher prefers 3.11 when available) and Node.js 18+.
- Provide Kokoro model assets via `KOKORO_MODEL` and `KOKORO_VOICES`. The launcher defaults to the project-local `./models/kokoro-v1.0.onnx` and `./models/voices-v1.0.bin`, downloading them automatically if missing.
- Optional `.env` (seeded from `.env.example`) lets you customise backend host/port, model download URLs, Ollama configuration, and Vite dev server overrides.
- Random paragraph generation will call an Ollama instance when `OLLAMA_URL`/`OLLAMA_MODEL` are set; otherwise it falls back to bundled sample snippets.
- Audio output uses `soundfile` to produce WAV files; the frontend renders them with WaveSurfer.js.

## Typical Workflow
1. **Launch**
   - Double-click `Start Kokoro Playground.command` (or execute it from Terminal).
   - The script sources `.env`, creates/updates `.venv`, installs backend/frontend dependencies only when definitions change, downloads models into `./models/` (when enabled), starts Flask on `http://127.0.0.1:7860`, then either boots Vite on `http://127.0.0.1:5173` (`KOKORO_MODE=dev`) or serves the built SPA directly (`KOKORO_MODE=prod`).
2. **Generate Speech**
   - Edit text in the Script panel or use “Insert random”/“Append random” (Ollama optional).
   - Select one voice to create a single clip; multiple voices enable the audition stitcher and optional announcer line.
   - Adjust language, speed, silence trimming, announcer template, and autoplay preferences.
3. **Review Results**
   - Clips appear in the Results panel with waveform playback, download, and remove controls.
   - Auditions concatenate announcer snippets (when enabled) and each selected voice with configurable gaps.

## Notable Behaviours
- Voice metadata is cached in-process and now includes accent identifiers/flags for the SPA.
- The Kokoro model is memoised to avoid reloading the ONNX weights between requests.
- Random text gracefully degrades to local snippets when Ollama is unavailable; categories are mirrored back to the UI.
- `/api/meta` reports API prefix, port, asset readiness, random text categories, Ollama availability, and frontend bundle status for the SPA.
- `/api/voices_grouped` returns accent groupings (e.g. 🇺🇸 American Female/Male, 🇬🇧 British Female/Male, etc.) for the selector chips.
- UI state (text, voices, settings) persists in `localStorage` to preserve your session.
- The backend serves `frontend/dist/` when the dev server is absent, enabling a single-process production deploy.

## Current Limitations
- No authentication or multi-user coordination; intended for local use.
- Ollama integration is best-effort; failures fall back to canned copy.
- No automated tests yet; audio generation remains a manual verification step.
- The launcher currently targets POSIX shells; Windows support would require additional scripting.

Use this overview as your starting point: tweak backend behaviour in `backend/app.py`, evolve the UI under `frontend/`, and lean on the launcher for a one-click local environment.
