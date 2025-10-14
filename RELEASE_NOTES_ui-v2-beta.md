# Kokoro UI v2 Beta (Codex B)

Tag: `ui-v2-beta`  •  Merge commit: `793b5fa`

This release delivers a modernized, state‑aware UI and the first phase of preview generation. It is the new baseline on `main`.

What’s new
- Voice Browser 2.0: hover previews, favorites, facet chips, bulk “Generate previews for filtered voices”.
- Script Authoring: SSML helper chips (Pause/Emphasis/Pitch/Rate), live counters, basic SSML validation.
- Queue & Results: bottom drawer with Queue | History, optimistic progress, session persistence, mini waveform trim/loop/export (WAV).
- Preview Generation (Kokoro): `POST /api/voices/preview` to cache ~5s previews in `out/voice_previews/kokoro/`; per‑card and bulk UI actions.
- Top bar: live queue badge on Clips chip; Quick Generate; Settings.
- Launchers: shared model reuse, `SKIP_BACKEND=1` for UI‑only, `TAKE_OVER=1` for XTTS, status summary, dev port auto‑pick.
- Docs: `AGENTS.md`, `API_ROUTES.md`, `DESIGN.md`.

Upgrade guidance
- Dev UI-only runs should set `VITE_API_BASE_URL` to the backend origin (e.g., `http://127.0.0.1:7860`).
- `out/` and preview artifacts are ignored by Git; do not commit generated audio.

Known limitations
- Queue cancel is UI-only (jobs are short and not cancelable yet).
- Preview generation implemented for Kokoro; other engines can be enabled with engine‑specific helpers.

API notes
- `/api/voices` (Kokoro) adds `raw.preview_url` once a preview exists.
- `/api/voices/preview { engine, voiceId, language?, force? }` generates or returns cache.

Have fun — it’s ready for usability testing and iterative polish.

