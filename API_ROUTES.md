# API Routes — Kokoro UI (CodexB)

Base URL: `${VITE_API_BASE_URL}/${VITE_API_PREFIX}` (defaults to same‑origin + `/api`).

Default hub port is `7860`. For peers over WireGuard, set:

```
export TTSHUB_API_BASE=http://<WG_IP_OF_MAC>:7860/api
```

Do not call local service ports (e.g., Draw Things on 127.0.0.1:7861) from peers. The hub proxies those via `/api/*`.

## GET /meta
- Returns runtime metadata: `api_prefix`, `port`, `has_model`, `has_voices`, `random_categories`, `accent_groups`, `voice_count`, `frontend_bundle`, `ollama_available`, `engines[]`, `default_engine`.

## GET /voices?engine=<id>
- Returns `{ engine, available, voices[], accentGroups[], count, styles?, presets?, message? }`.
- Voice shape (engine‑agnostic fields): `id`, `label`, `locale`, `gender`, `tags[]`, `notes`, `accent{ id,label,flag }`, `raw{ ... }`.
- Kokoro adds `raw.preview_url` when a cached preview exists. The voice objects include `engine`.

## GET /voices_grouped?engine=<id>
- Returns grouped voice buckets: `{ id, label, flag?, voices[], count }`.

## GET /voices_catalog?engine=<id>
- Combined catalogue + filter metadata for simple clients (bots/integrations).
- Returns:
  - `engine`, `available`, `count`
  - `voices[]` (same shape as `GET /voices`, with `engine` on each item)
  - `filters`:
    - `engines[]` — from `/meta` (id, label, available, status)
    - `genders[]` — `{ id: 'female'|'male'|'unknown', label, count }`
    - `locales[]` — `{ id: 'en-us'|'en-gb'|..., label, count }` (misc bucket when unknown)
    - `accents[]` — same buckets as `accentGroups`
    - `accentFamilies` — normalized, gender-aware buckets with merged counts:
      - `any[]` — counts for families like `us`, `uk`, `other` regardless of gender
      - `female[]` — counts for the same families restricted to female voices
      - `male[]` — counts restricted to male voices

## GET /random_text?category=<name>
- Returns test text: `{ text, source, category, categories[] }`.

## GET /ollama_models
- Returns `{ models[], source, url, error? }`.

## GET /ollama/tags
- Proxy to Ollama `/api/tags`. Returns the raw tags payload.

## POST /ollama/generate
- Proxy to Ollama `/api/generate`. Body is forwarded as JSON.
- `stream=false` (default): returns a single JSON object.
- `stream=true`: streams NDJSON wrapped as SSE (`text/event-stream`).

## POST /ollama/chat
- Proxy to Ollama `/api/chat`. Body is forwarded as JSON.
- `stream=false` (default): returns a single JSON object.
- `stream=true`: streams NDJSON wrapped as SSE.

## POST /ollama/pull
- Proxy to Ollama `/api/pull` to fetch a model.
- Body: `{ model: "llama3:8b", stream?: boolean }` (`name` also accepted).
- `stream=true` (default): streams progress as SSE; `false` returns a final JSON snapshot.

## GET /ollama/ps
- Proxy to `/api/ps` (running models/status).

## GET|POST /ollama/show
- Proxy to `/api/show` for model details. Use `?model=name` or body `{ model: name }`.

## GET|POST /ollama/delete
- Proxy to `/api/delete` to remove a model from the local store. Use `?model=name` or body `{ model: name }`.

## Draw Things (Stable Diffusion) proxy

Draw Things exposes an AUTOMATIC1111‑compatible HTTP API when enabled in the app. The hub can proxy it so peers over WireGuard can call Stable Diffusion through the same base.

- Env: `DRAWTHINGS_URL` (default `http://127.0.0.1:7859`)
- `GET /drawthings/models` — proxy to `/sdapi/v1/sd-models`
- `GET /drawthings/samplers` — proxy to `/sdapi/v1/samplers`
- `GET /drawthings/options` — proxy to `/sdapi/v1/options` (e.g., `sd_model_checkpoint`)
- `POST /drawthings/txt2img` — proxy to `/sdapi/v1/txt2img` (JSON body forwarded verbatim; response returned as-is with base64 images)
- `POST /drawthings/img2img` — proxy to `/sdapi/v1/img2img`

Notes
- Some Draw Things builds do not implement those list endpoints; the hub will return `200 []` instead of an error.

Examples

```
export TTSHUB_API_BASE=http://<WG_IP_OF_MAC>:7860/api

# List models
curl -sS "$TTSHUB_API_BASE/drawthings/models" | jq '.[0]'

# txt2img (minimal)
curl -sS -X POST "$TTSHUB_API_BASE/drawthings/txt2img" \
  -H 'content-type: application/json' \
  -d '{"prompt":"A watercolor fox in the forest","steps":20,"width":512,"height":512}' | jq '.images[0] | .[0:64]'
```

## Telegram convenience

`POST /telegram/draw` — Simplified prompt→image endpoint backed by Draw Things.

Body
- `{ prompt: string, width?: number, height?: number, steps?: number, seed?: number, negative?: string, sampler?: string, cfgScale?: number, preset?: string, model?: string }`

Presets (optional)
- `preset`: one of `flux_fast`, `flux_balanced`, `flux_photoreal`, `hidream_fast`, `hidream_balanced`, `hidream_photoreal`, `fast`, `balanced`, `illustration`, `anime`, or `auto`.
- Presets fill sensible defaults for `sampler`, `steps`, `cfgScale` and a default size when `width/height` are not provided.
  - FLUX.1 [schnell]
    - `flux_fast`: Euler a, steps~6, cfg~4.5, default 512×512
    - `flux_balanced`: Euler a, steps~8, cfg~5.0, default 640×512
    - `flux_photoreal`: Euler a, steps~10, cfg~5.5, default 768×512
  - HiDream / SDXL family
    - `hidream_fast`: DPM++ SDE Karras, steps~12, cfg~5.5, default 640×512
    - `hidream_balanced`: DPM++ 2M Karras, steps~24, cfg~6.0, default 768×512
    - `hidream_photoreal`: DPM++ 2M SDE Karras, steps~28, cfg~5.5, default 896×640
  - General (SDXL/SD1.x)
    - `fast`: Euler a, ~18 steps, cfg~6.0, default 512×512
    - `balanced`: DPM++ 2M Karras, ~28 steps, cfg~6.5, default 768×512
    - `illustration`: DPM++ 2S a Karras, ~28 steps, cfg~7.5, default 640×640
    - `anime`: Euler a, ~24 steps, cfg~8.0, default 640×640

`auto` behavior
- If `preset` is missing/`auto` or not recognized, the hub infers a preset from `model`:
  - Contains "flux" → `flux_balanced`
  - Contains "hidream"/"i1"/"sdxl" → `hidream_balanced`
  - Otherwise → `balanced`

Model (optional)
- `model`: checkpoint name; maps to A1111 `override_settings.sd_model_checkpoint` for this call only.

Notes
- Clamps width/height to 64–1024 and rounds to a multiple of 8.
- Saves the first returned image under `out/drawthings_images/` and returns a URL for easy sharing.
- `stylePreset` (optional): one of `watercolor`, `photoreal`, `anime`, `illustration`, `cinematic`, `product`. Appends style tags to the prompt.
- `negativePreset` (optional): one of `clean`, `portrait`, `product`, `anime`, `nsfw_filter`. Appends cleaning terms to `negative_prompt`.

Response
- `{ url: "/image/drawthings/<file>.png", filename, width, height, steps, seed?, sampler?, provider: 'drawthings' }`

Example
```
curl -sS -X POST "$TTSHUB_API_BASE/telegram/draw" \
  -H 'content-type: application/json' \
  -d '{"prompt":"Sunlit watercolor fox","steps":20,"width":512,"height":512}' | jq
```

`GET /telegram/presets` — List available image/style/negative presets

Response
```
{
  "presets": {
    "flux_balanced": { "label": "Flux · Balanced", "family": "flux", "sampler": "DPM++ SDE Karras", "steps": 14, "cfgScale": 5.5, "defaultSize": { "width": 640, "height": 512 } },
    ...
  },
  "stylePresets": { "watercolor": { "label":"Watercolor", "tags":"..." }, ... },
  "negativePresets": { "clean": { "label":"Clean", "tags":"..." }, ... },
  "order": { "presets": [ ...keys... ], "stylePresets": [ ... ], "negativePresets": [ ... ] },
  "defaults": { "preset": "flux_balanced" }
}
```

## POST /synthesise (alias: /synthesize)
- Body: `{ text, voice, speed, language, trimSilence, engine? }` plus engine‑specific overrides (`style`, `speaker`, `seed`).
- Also supports favorites: pass `favoriteId` or `favoriteSlug` (aliases: `profileId`/`profileSlug`) to resolve engine/voice/options from the Favorites store; the request body supplies the `text`.
- Returns `{ id, engine, voice, path|url|filename|clip, sample_rate?, ... }`.

## POST /audition
- Body: `{ text, voices[], speed, language, trimSilence, announcer?, gapSeconds?, engine?, voiceOverrides? }`.
- Returns a stitched clip (same shape as `/synthesise`).

## POST /chattts/presets
- Body: `{ label, speaker, seed?, notes? }`.
- Returns `{ preset, presets }` and refreshes catalogue.

## POST /voices/preview (Phase 3)
- Body: `{ engine, voiceId, language?, force?, ...engineSpecific }`.
  - Kokoro: respects `language`, `speed`, `trimSilence` (optional) and caches under `out/voice_previews/kokoro/`.
  - XTTS v2: accepts `language`, `speed`, `trimSilence`, `seed`, `temperature`, `format`, `sample_rate`; caches under `out/voice_previews/xtts/`.
  - OpenVoice v2: accepts `language` (defaults to the voice’s locale) and `style`. Uses existing reference clips and caches under `out/voice_previews/openvoice/`.
  - ChatTTS: accepts `language`, `seed`, and `speaker`. Normalises the generated MP3, trims/fades, and caches under `out/voice_previews/chattts/`.
- All engines return `{ preview_url }`; subsequent `/voices` responses expose the cached path via `voice.raw.preview_url`.
- Pass `force=true` to regenerate and overwrite the cached sample.

## GET /audio/<filename>
- Serves generated audio from `out/` (previews included under `out/voice_previews/...`).

## GET /audio/openvoice/<path>
- Serves OpenVoice reference files from `openvoice/resources/` for inline previews.

## Favorites

Favorites are engine‑agnostic presets (label + engine + voice + optional params) saved locally and callable from scripts.

- GET `/favorites` → `{ profiles[], count }` (filter with `?engine=<id>` and/or `?tag=<name>`)
- POST `/favorites` → create a favorite. Body: `{ label, engine, voiceId, slug?, language?, speed?, trimSilence?, style?, seed?, serverUrl?, tags?, notes?, meta? }`.
- GET `/favorites/:id` → single favorite
- PATCH `/favorites/:id` → update any of the fields above
- DELETE `/favorites/:id`
- GET `/favorites/export` → `{ schemaVersion, profiles[] }`
- POST `/favorites/import` → `{ imported, mode }` with body `{ profiles[], mode?: 'merge'|'replace' }`

Auth: If `FAVORITES_API_KEY` is set, Favorites routes require header `Authorization: Bearer <key>`.

Storage: Defaults to `~/.kokoro/favorites.json` (override with `FAVORITES_STORE_PATH`).

Notes
- `/synthesise` aliases: request may include `favoriteId`/`favoriteSlug` (and legacy `profileId`/`profileSlug`) to resolve engine/voice/params; body supplies `text`.
- All errors return JSON via `PlaygroundError` with `{ error, status }`.
- In dev, set `VITE_API_BASE_URL` so the SPA on 5175 fetches `/audio/...` from the backend on 7860.

## Media Editing

Transcript-driven media editing endpoints used by the Media Editor (beta).

- POST `/media/transcribe` — Upload audio or `{ source: 'youtube', url }` to produce a transcript with word timings; returns `media.audio_url` (WAV).
- POST `/media/align` — Force-align the full transcript with WhisperX for improved word boundaries.
- POST `/media/align_region` — Align only a selected region; merges refined words; returns stats and optional `diff_url`.
- POST `/media/replace_preview` — Generate an audio preview that replaces or overlays a selected region with XTTS; supports fade/duck/trim parameters.
- POST `/media/apply` — Mux the preview audio into the original container (video or audio-only); auto-selects codec, falls back to re-encode when needed.
- GET `/media/stats` — Returns recent runtime factors (RTFs) used for ETAs.
- POST `/media/estimate` — Estimate YouTube duration using `yt-dlp` (supports cookies and extractor args).
- POST `/media/probe` — Return `ffprobe` JSON for an uploaded file to inspect tracks/format.

See `docs/MEDIA_EDITING_WITH_XTTS.md` for payload shapes and the full UI flow.

## XTTS Custom Voices

Create and manage XTTS reference voices that appear in the XTTS catalogue (`/voices?engine=xtts`). References are stored under `XTTS/tts-service/voices/` with an optional sidecar JSON for metadata (`<voice>.meta.json`).

- POST `/xtts/custom_voice`
  - Multipart upload: fields `file` (audio), optional `label`, `start`, `end` (mm:ss or seconds)
  - JSON (YouTube): `{ source: 'youtube', url, start?, end?, label? }`
  - Normalises to mono 24 kHz WAV via ffmpeg and validates length (default 5–30 seconds).
  - Returns `{ status, engine: 'xtts', voice: { id, label, path, preview_url? } }`.
  - Notes: requires `ffmpeg`; YouTube import additionally requires `yt-dlp`.

- GET `/xtts/custom_voice/:id`
  - Returns `{ id, label, path, meta }` where `meta` is the sidecar JSON if present.

- PATCH `/xtts/custom_voice/:id`
  - Updates sidecar fields: `{ language?, gender?, tags?, notes?, accent? }`.
  - `accent` is `{ id, label, flag }` and is used for UI filtering (not sent to the engine).
  - `language` is the voice’s default language; the UI can auto‑apply it on selection.

- DELETE `/xtts/custom_voice/:id`
  - Removes the WAV and its sidecar.

Sidecar example (`<voice>.meta.json`)
```
{
  "language": "en-us",
  "gender": "male",
  "accent": { "id": "us", "label": "USA · Male", "flag": "🇺🇸" },
  "tags": ["british", "custom"],
  "notes": "Sample from YouTube",
  "source": { "type": "youtube", "url": "https://…", "title": "…", "start": 5, "end": 22 },
  "createdAt": "2025-10-23T06:30:00Z"
}
```
