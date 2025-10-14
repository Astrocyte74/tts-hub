# API Routes — Kokoro UI (CodexB)

Base URL: `${VITE_API_BASE_URL}/${VITE_API_PREFIX}` (defaults to same‑origin + `/api`).

## GET /meta
- Returns runtime metadata: `api_prefix`, `port`, `has_model`, `has_voices`, `random_categories`, `accent_groups`, `voice_count`, `frontend_bundle`, `ollama_available`, `engines[]`, `default_engine`.

## GET /voices?engine=<id>
- Returns `{ engine, available, voices[], accentGroups[], count, styles?, presets?, message? }`.
- Voice shape (engine‑agnostic fields): `id`, `label`, `locale`, `gender`, `tags[]`, `notes`, `accent{ id,label,flag }`, `raw{ ... }`.
- Kokoro adds `raw.preview_url` when a cached preview exists.

## GET /voices_grouped?engine=<id>
- Returns grouped voice buckets: `{ id, label, flag?, voices[], count }`.

## GET /random_text?category=<name>
- Returns test text: `{ text, source, category, categories[] }`.

## GET /ollama_models
- Returns `{ models[], source, url, error? }`.

## POST /synthesise (alias: /synthesize)
- Body: `{ text, voice, speed, language, trimSilence, engine? }` plus engine‑specific overrides (`style`, `speaker`, `seed`).
- Returns `{ id, engine, voice, path|url|filename|clip, sample_rate?, ... }`.

## POST /audition
- Body: `{ text, voices[], speed, language, trimSilence, announcer?, gapSeconds?, engine?, voiceOverrides? }`.
- Returns a stitched clip (same shape as `/synthesise`).

## POST /chattts/presets
- Body: `{ label, speaker, seed?, notes? }`.
- Returns `{ preset, presets }` and refreshes catalogue.

## POST /voices/preview (Phase 3)
- Body: `{ engine, voiceId, language?, force? }`.
- Behavior (Kokoro): get‑or‑create a ~5s preview WAV under `out/voice_previews/kokoro/` with trim+normalize+fade.
- Returns `{ preview_url }` and `/voices` will include `raw.preview_url` thereafter.

## GET /audio/<filename>
- Serves generated audio from `out/` (previews included under `out/voice_previews/...`).

## GET /audio/openvoice/<path>
- Serves OpenVoice reference files from `openvoice/resources/` for inline previews.

Notes
- All errors should return JSON via `PlaygroundError` with `{ error, status }`.
- In dev, set `VITE_API_BASE_URL` so the SPA on 5175 fetches `/audio/...` from the backend on 7860.
