# Kokoro Playground SPA

Modern single-page frontend for the Kokoro text-to-speech playground, built with React, TypeScript, and Vite. The SPA talks to the Flask API, providing tooling for browsing voices, editing scripts, triggering synthesis or multi-voice auditions, and auditioning generated clips with rich waveforms.

## Features

- Voice browser with backend-provided locale groupings, search, and multi-select.
- Script workbench with random-text helpers connected to `/api/random_text`, mirroring live categories.
- Shared synthesis settings (language, speed, silence trimming) with localStorage persistence.
- Announcer controls for auditions (voice, template, gap) plus stitched multi-voice clips via `/api/audition`.
- Inline waveform playback powered by WaveSurfer.js, with quick download/remove actions.
- API base configurable via environment variables so the UI can target any running backend.

## Getting Started

```bash
cd frontend
npm install
cp .env.example .env           # optional; launcher auto-seeds this file
npm run dev
```

> Tip: Double-clicking `../Start Kokoro Playground (XTTS Server).command` launches both the Flask backend and this Vite dev server automatically.

By default Vite serves the SPA on `http://127.0.0.1:5175`. The app expects the Flask playground to be running (e.g. via `Start Kokoro Playground (XTTS Server).command`) and accessible at the host configured in `.env`.

## Environment

| Variable | Description |
| --- | --- |
| `VITE_API_BASE_URL` | Base URL for the Flask backend (e.g. `http://127.0.0.1:7860`). Leave empty to proxy through the same origin. |
| `VITE_API_PREFIX` | Path segment prepended before endpoint names. Defaults to `api` to match the Flask blueprint. |
| `VITE_HOST` | Hostname Vite should bind to (defaults to `127.0.0.1`). |
| `VITE_PORT` | Port for the dev server (defaults to `5175`). |

Both values are optional. When omitted the SPA calls relative paths such as `/voices` and relies on Vite proxying during development.

## Production Build

```bash
npm run build
npm run preview  # optional static preview
```

The build outputs static assets under `frontend/dist/`. Serve these via any static host, or drop the folder alongside the backend—the Flask app will serve the bundle automatically when Vite is not running.
