# TTS Hub Roadmap & Handoff Notes

These notes capture the multi-engine refactor currently in progress inside `tts-hub/` so that any teammate (human or AI) can keep extending the playground without losing context.

## Vision

Deliver a single “Kokoro Playground” interface that can drive several local TTS engines:

- **Kokoro (ONNX)** – fast baseline voices, already fully integrated.
- **XTTS v2** – high-quality cloning. Repository lives at `./XTTS`; CLI is now invoked via the playground adapter (subprocess).
- **OpenVoice v2** – instant multi-lingual cloning. Repo at `./openvoice`; checkpoints downloaded and CLI verified.
- **ChatTTS** – dialogue-tuned model. Repo at `./chattts`; Python CLI works and returns MP3 out of the box.

Each engine keeps its own repo/venv/asset footprint. The playground backend exposes them via a registry, while the React app lets users switch engines, see availability, and fall back gracefully when a catalog is missing.

## What’s Done

### Backend (`kokoro_twvv/backend/app.py`)
- Added a **global engine registry** with metadata (labels, availability check, capabilities).
- Default engine remains `kokoro`; XTTS is active via CLI, while OpenVoice and ChatTTS entries still report `status: planned`.
- `/api/meta` now returns `engines` and `default_engine` fields in addition to Kokoro accent data.
- `/api/voices`, `/api/voices_grouped`, and `/api/synthesise` accept `engine` query/body parameters and dispatch through the registry.
- Kokoro adapter remains in-process (`synthesise_audio_clip`, `load_voice_profiles`).
- XTTS adapter shells out to `tts_service.cli`, discovers speakers under `XTTS/tts-service/voices/`, and marks availability based on that inventory.
- Audition endpoint rejects non-Kokoro engines with a friendly 400 error (until another engine supports multi-voice stitching).

### Frontend (`kokoro_twvv/frontend/src`)
- Added `TtsEngineMeta`/`VoiceCatalogue` types and engine-aware API helpers.
- Synthesis controls now include an **engine selector**, availability banner, and status messaging.
- Voice browser disables itself when an engine is unavailable and shows per-engine group data (or a placeholder).
- Synthesis requests append `engine`, and recorded results retain which engine produced them.
- UI resets selected voices when the engine changes; announcer controls only appear for Kokoro.

### External repos inside `tts-hub/`
- `kokoro_twvv/` – clean Git state after current changes (pending commit below).
- `XTTS/` – CLI verified; backend adapter now calls it automatically when XTTS is selected.
- `openvoice/` – `python scripts/cli_demo.py` works with downloaded checkpoints.
- `chattts/` – `examples/cmd/run.py` generates MP3 after editable install (`pip install -e .`).

## Immediate Next Steps

1. **Implement adapters for OpenVoice and ChatTTS**
   - Decide invocation strategy (subprocess vs. HTTP) and wire up `availability`, `prepare`, `synthesise`, and `fetch_voices`.
   - Standardise result payloads to include `voice`, `path`, `sample_rate`, etc.
2. **Voice metadata**
   - OpenVoice: surface base speaker list + styles from checkpoints.
   - ChatTTS: expose seed presets or pseudo voices if available; otherwise keep as “default voice”.
3. **Auditions for other engines**
   - Once another engine can synthesise multiple voices deterministically, extend the audition endpoint/adapter to support it.
4. **Docs & onboarding**
   - Expand top-level README for `tts-hub` describing how to install each engine, start background services (if any), and configure env vars the backend expects (e.g., XTTS CLI path).

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
