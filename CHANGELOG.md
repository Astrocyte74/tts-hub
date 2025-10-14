# Changelog

All notable changes to this project will be documented here.

## [ui-v2-beta] – 2025-10-13

Highlights
- Modernized Kokoro UI (Codex B) merged to `main` (merge commit 793b5fa) and tagged `ui-v2-beta`.
- Voice Browser 2.0
  - Hover micro‑preview on cards (plays cached sample when present)
  - Favorites with pinned row (local persistence)
  - Facet chips for Language / Gender / Style with live counts and multi‑select
  - Header action to bulk-generate missing previews for the filtered set
- Script Authoring
  - SSML helper chips (Pause, Emphasis, Pitch, Rate)
  - Live counters for words/characters and duration estimate
  - Basic SSML validation (balanced tags)
- Queue & Results
  - Bottom drawer with Queue | History tabs
  - Optimistic progress + session persistence across reloads
  - Mini waveform with Loop + Start/End sliders and Export selection (WAV)
  - Top bar Clips chip shows a live queue badge (running/total)
- Preview Generation (Phase 3 – Kokoro)
  - Endpoint `POST /api/voices/preview { engine, voiceId, language?, force? }`
  - Cached short previews in `out/voice_previews/kokoro/` (trim + normalize + fade)
  - Per‑card “Generate preview” chip and bulk action for filtered sets
- Dev Experience
  - Launchers auto‑reuse shared models from `../kokoro_twvv/models`
  - `SKIP_BACKEND=1` to run UI‑only (dev), and `TAKE_OVER=1` for XTTS restart
  - Status summary at startup and dev port auto‑pick
  - New docs: `AGENTS.md`, `API_ROUTES.md`, and unified `DESIGN.md`

Breaking changes
- None expected; existing launcher workflows continue to function. The UI adds new panels and actions but remains single‑page.

Upgrade notes
- Ensure `.env` (or `.env.local`) points to your backend if you run UI-only; set `VITE_API_BASE_URL=http://127.0.0.1:7860`.
- The output directory `out/` and subfolder `out/voice_previews/` are ignored by Git.

