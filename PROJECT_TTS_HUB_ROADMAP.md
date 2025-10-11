# TTS Hub Roadmap & Handoff Notes

These notes capture the multi-engine refactor currently in progress inside `tts-hub/` so that any teammate (human or AI) can keep extending the playground without losing context.

## Vision

Deliver a single “Kokoro Playground” interface that can drive several local TTS engines:

- **Kokoro (ONNX)** – fast baseline voices, already fully integrated.
- **XTTS v2** – high-quality cloning. Repository lives at `./XTTS`; CLI is now invoked via the playground adapter (subprocess).
- **OpenVoice v2** – instant multi-lingual cloning. Repo at `./openvoice`; CLI is now called via the playground adapter (subprocess).
- **ChatTTS** – dialogue-tuned model. Repo at `./chattts`; CLI is wired into the playground (random speaker per request).

Each engine keeps its own repo/venv/asset footprint. The playground backend exposes them via a registry, while the React app lets users switch engines, see availability, and fall back gracefully when a catalog is missing.

## Architecture at a Glance

- **Backend**
  - Flask blueprint exposes `/api/meta`, `/api/voices`, `/api/voices_grouped`, `/api/synthesise`, `/audio/*`.
  - `ENGINE_REGISTRY` maps engine ids to `availability`, `prepare`, `synthesise`, and `fetch_voices` callables.
  - Each adapter sticks to a simple contract: normalise the incoming payload, invoke the engine (in-process or CLI), and return `{ id, engine, voice, path, filename, sample_rate }`.
  - Engines are “pluggable” by adding constants & helper functions near the top of `backend/app.py` and registering them in `ENGINE_REGISTRY`.

- **Files & outputs**
  - Generated audio is copied into `kokoro_twvv/out/` and served back via `/audio/<filename>`.
  - CLI-based engines (XTTS/OpenVoice/ChatTTS) run in their home directories and move the resulting files into `out/`.

- **Frontend**
  - React Query fetches metadata, voices, and grouped voices per engine.
  - Engine selector (`SynthesisControls`) reflects availability/messages coming from `/api/voices`.
  - Voice browser (`VoiceSelector`) disables itself when the engine is offline and shows grouped metadata when available.
  - Synthesis results store the `engine` id in `meta.engine` so the history panel makes it obvious which engine produced a clip.

## Engine Adapter Cheat Sheet

| Engine | Invocation | Voice discovery | Key env vars |
| --- | --- | --- | --- |
| Kokoro | in-process `kokoro_onnx.Kokoro` | `models/voices-v1.0.bin` | `KOKORO_MODEL`, `KOKORO_VOICES` |
| XTTS | `XTTS/.venv/bin/python -m tts_service.cli` | files under `XTTS/tts-service/voices/` | `XTTS_ROOT`, `XTTS_PYTHON`, `XTTS_TIMEOUT`, `XTTS_OUTPUT_FORMAT` |
| OpenVoice | `openvoice/.venv/bin/python scripts/cli_demo.py` | files under `openvoice/resources/` (English only) | `OPENVOICE_ROOT`, `OPENVOICE_PYTHON`, `OPENVOICE_CKPT_ROOT`, `OPENVOICE_TIMEOUT`, `OPENVOICE_WATERMARK` |
| ChatTTS | `chattts/.venv/bin/python examples/cmd/run.py` | default "Random Speaker"; optional presets under `chattts/presets/` | `CHATTT_ROOT`, `CHATTT_PYTHON`, `CHATTT_TIMEOUT`, `CHATTT_SOURCE`, `CHATTT_PRESET_DIR` |

> Tip: All env vars have sensible defaults assuming the repo layout under `tts-hub/`, so engines work out-of-the-box when the sibling repos are present.

## UI Behaviour Highlights

- Engine selector persists in `localStorage` (`kokoro:engine`). Switching engines resets the selected voice(s) and announcer data.
- OpenVoice engine exposes an English style dropdown persisted under `kokoro:openvoiceStyle`.
- ChatTTS auto-selects a random speaker by default and shows a preset selector when saved embeddings are available.
- ChatTTS controls now expose an optional seed input to rerun the same sampled speaker without saving a preset.
- ChatTTS result cards now expose speaker/seed info plus a “Save as preset” button that opens a friendly modal; existing voices are flagged (keeping duplicates optional).
- Kokoro auditions remain the only multi-voice path; other engines will return 400s if the audition endpoint is invoked.


## What’s Done

### Backend (`kokoro_twvv/backend/app.py`)
- Added a **global engine registry** with metadata (labels, availability check, capabilities).
- Default engine remains `kokoro`; XTTS, OpenVoice, and ChatTTS now have working adapters registered in the backend.
- `/api/meta` now returns `engines` and `default_engine` fields in addition to Kokoro accent data.
- `/api/voices`, `/api/voices_grouped`, and `/api/synthesise` accept `engine` query/body parameters and dispatch through the registry.
- Kokoro adapter remains in-process (`synthesise_audio_clip`, `load_voice_profiles`).
- XTTS adapter shells out to `tts_service.cli`, discovers speakers under `XTTS/tts-service/voices/`, and marks availability based on that inventory.
- OpenVoice adapter wraps `scripts/cli_demo.py`, enumerates references in `openvoice/resources/`, and exposes language/style hints.
- ChatTTS adapter reads optional speaker presets from `chattts/presets` (JSON or TXT) and surfaces them through `/api/voices`.
- ChatTTS `/api/synthesise` responses now include the resolved speaker embedding and seed, and `/chattts/presets` accepts POSTs to create presets from the UI.
- OpenVoice payloads are now normalised to English-only variants (Chinese metadata removed).
- ChatTTS synthesis accepts an optional deterministic seed that is forwarded to the CLI.
- Audition endpoint rejects non-Kokoro engines with a friendly 400 error (until another engine supports multi-voice stitching).

### Frontend (`kokoro_twvv/frontend/src`)
- Added `TtsEngineMeta`/`VoiceCatalogue` types and engine-aware API helpers.
- Synthesis controls now include an **engine selector**, availability banner, and status messaging.
- Voice browser disables itself when an engine is unavailable and shows per-engine group data (or a placeholder).
- Synthesis requests append `engine`, and recorded results retain which engine produced them.
- UI resets selected voices when the engine changes; announcer controls only appear for Kokoro.
- ChatTTS settings expose a speaker preset selector when `chattts/presets` provides saved embeddings.
- Kokoro result cards now surface a **Save as favorite** action that reuses the shared preset dialog; saved favorites persist in `localStorage` (`kokoro:favorites`) and display badges on already-favorited clips.
- Settings panel exposes a Kokoro favorites dropdown so saved presets can instantly re-select their voice profiles.
- Favorites manager modal lets users rename or delete Kokoro favorites without leaving the app.
- OpenVoice clips now show style/language badges, inline reference previews (with download fallback), and preserve the style used per clip via voice-specific overrides.
- XTTS/OpenVoice/ChatTTS now participate in the audition workflow (announcer options, per-voice overrides) so multi-voice reels behave consistently across engines.
- Added an OpenVoice help modal with recording tips (15–30s clips, iPhone-class mics recommended) and step-by-step instructions for dropping custom references into `openvoice/resources/`.

### External repos inside `tts-hub/`
- `kokoro_twvv/` – clean Git state after current changes (pending commit below).
- `XTTS/` – CLI verified; backend adapter now calls it automatically when XTTS is selected.
- `openvoice/` – CLI wired into the playground; references under `resources/` appear as selectable voices.
- `chattts/` – CLI output now feeds the playground; default “Random Speaker” voice is exposed.
  - Sample preset `chattts/presets/storyteller-01.json` demonstrates the JSON format (speaker string escaped for portability).

## Immediate Next Steps

1. **ChatTTS enhancements**
   - Add capture-from-UI workflows so new presets can be minted without leaving the playground.
   - Investigate keeping a warm ChatTTS session alive to avoid repeated model loads.
   - Standardise CLI output handling if you want WAV support in addition to MP3.
2. **OpenVoice polish**
   - Add per-voice editing controls so styles can be overridden inline without relying on the global dropdown.
   - Cache/serve reference previews through the backend to avoid `file://` fallbacks when packages move.
3. **Auditions for other engines**
   - Once another engine can synthesise multiple voices deterministically, extend the audition endpoint/adapter to support it.
4. **Docs & onboarding**
   - Expand top-level README for `tts-hub` describing how to install each engine, start background services (if any), and configure env vars the backend expects (XTTS/ChatTTS/OpenVoice paths).
5. **Favorites sync**
   - Persist Kokoro favorites server-side (or support import/export) so teams can share curated voice collections.

## Longer-Term Ideas

- Spawn each engine as a background process managed by the playground (with health checks under `/api/meta`).
- Cache generated clips per engine to avoid recomputation.
- Offer per-engine configuration panes (temperature, reference audio upload, etc.).
- Bundle everything into a LaunchAgent/Start command similar to the original Kokoro script.

## Quick Reference

```
tts-hub/
├── kokoro_twvv/        # playground (backend/frontend) – uses current venvs
├── XTTS/               # XTTS service & CLI
├── openvoice/          # OpenVoice v1/v2 (checkpoints in ./checkpoints*)
└── chattts/            # ChatTTS (assets download into ./asset)
```

- Kokoro backend entry point: `python backend/app.py`
- Frontend dev mode: `npm run dev` (from `frontend/`)
- XTTS sample CLI: `cd XTTS/tts-service && source .venv/bin/activate && python -m tts_service.cli ...`
- OpenVoice CLI: `cd openvoice && source .venv/bin/activate && python scripts/cli_demo.py`
- ChatTTS CLI: `cd chattts && source .venv/bin/activate && python examples/cmd/run.py "Hello"`

With the registry scaffolding in place, future adapters only need to populate the correct call hooks—no major frontend rewrites required.
