# Media Editing — Transcript Replace with XTTS (v1 Plan)

Goal
- Paste a YouTube URL or upload a video/audio file.
- Display an accurate transcript with word timings (Mac‑native, offline).
- Let users select a word/phrase and replace it with new text, cloned in the same voice (XTTS).
- Duration-fit, loudness-match, and crossfade the replacement; export patched audio/video.

Scope (v1)
- Single‑speaker workflows; diarization optional later.
- Word‑level selection and replace; simple undo by re‑rendering.
- Preview audio patch first; then mux into original video container.

Ingestion
- URL: `yt-dlp -f bestaudio/best` (uses `YT_DLP_COOKIES_PATH` if present; retries enabled), normalize to mono 24 kHz WAV for STT.
- File: accept `mp4|mkv|mov|wav|mp3|flac|ogg`; extract/convert via ffmpeg.

STT + Alignment (local)
- Transcribe: faster‑whisper (CTranslate2) for Mac‑native speed/CPU.
- Forced alignment: WhisperX on top of the faster‑whisper transcript for robust word timings.
- Optional later: diarization (pyannote) — off by default to avoid heavy deps.
- Output shape:
  - `{ language, segments: [{text,start,end}], words: [{text,start,end,prob}], speakers? }`.

Voice cloning (XTTS)
- “Borrow voice from selection” → extract the selected source region, normalize to mono 24 kHz WAV, create a temporary XTTS custom voice (reusing the existing endpoint).
- Alternatively choose an existing XTTS custom voice or a Favorite (preset) for replacement.

Replacement rendering
- Synthesize the new text via XTTS using selected voice (language/speed as needed).
- Fit duration:
  - Target = selected region duration; use ffmpeg `atempo` to match (chain if outside 0.5–2.0 per step).
- Loudness match:
  - Probe RMS around selection (pre/post 0.5 s), normalize synthesized audio to within ~1 dB.
- Stitching:
  - Replace or duck original segment (mute or −18 dB), overlay synthesized segment.
  - Crossfades ~25–50 ms at in/out boundaries to mask seams.

Export
- Audio preview: write to `out/media_edits/<jobId>/preview.wav`.
- Final video: mux patched audio into original container via ffmpeg, write `final.mp4`.
- Keep artifacts (source wav, aligned JSON, clips) under the job folder for reproducibility.

UI (new “Transcript” panel)
- New segment in the top stepper: Script → Engine → Voice → Clips → Transcript (or “Edit”).
- Elements:
  - File/URL input with progress feedback (reuses queue panel visuals).
  - Transcript viewer with word‑level spans; drag to select phrase; inline “Replace…” action.
  - Replace dialog: input new text; toggle “Borrow voice from selection” or choose Favorite/Custom voice.
  - Buttons: Preview replacement, Apply to video, Export audio only.

Backend helpers (phase in gradually)
- Extract + normalise: ffmpeg helpers for audio track and segment trims.
- STT: faster‑whisper wrapper with model caching; CPU by default; env‑selectable size.
- Alignment: WhisperX wrapper; optional diarization (off by default).
- Replace pipeline: small, composable functions (fit duration, loudness match, stitch, mux).
- Job harness: run long tasks with progress updates routed into the existing Results drawer.

Configuration
- `YT_DLP_COOKIES_PATH` — used for YouTube imports (already supported).
- `WHISPER_MODEL` — default `medium` or `base.en` (tune for speed/accuracy).
- `WHISPERX_ENABLE` — `1` to enable forced alignment; otherwise fallback to segment timings.
- `DIARIZATION_ENABLE` — optional; off by default.

Backends and fallbacks (planned)
- `STT_PREFERRED` — `faster-whisper` | `whispercpp` | `auto` (default `auto`).
- `STT_FALLBACK` — `whispercpp` | `stub` (default `stub`).
- `WHISPER_CPP_BIN` — path to whisper.cpp CLI (e.g., `~/bin/whisper-cpp`).
- `WHISPER_CPP_MODEL` — path to .ggml / CoreML model.
  - Behavior: prefer `faster-whisper`; on failure, try `whisper.cpp`; otherwise stub (if enabled).

Dependencies
- Required: ffmpeg, yt-dlp, faster‑whisper (CTranslate2 models), numpy.
- Optional: WhisperX (+ torch), pyannote diarization later; pydub as convenience wrapper (still backed by ffmpeg).
- Not needed: aeneas (covered by WhisperX), audacity macros (not server‑side friendly).

Security & Ethics
- You are responsible for the rights to edit media; the UI should remind users for YouTube sources.
- Keep edits local; do not upload user media. Respect API auth when exposing over WireGuard.

Phased delivery
- P1: Ingest (yt-dlp/file) → STT (faster‑whisper) → simple word selection → XTTS synth → audio preview (replace/overlay).
- P2: WhisperX alignment + duration fit/loudness/crossfades; job artifacts.
- P3: Full video mux export; temp voice from selection; Favorites integration.
- P4: Optional diarization; background bed preservation; batch edits and undo stack.

Enhancements under consideration
- Transcription fallback chain
  - Configurable preference/fallback (prefer faster‑whisper, fall back to whisper.cpp, then stub for UI dev).
  - Env knobs: `STT_PREFERRED`, `STT_FALLBACK`, `WHISPER_CPP_BIN`, `WHISPER_CPP_MODEL`.

- Output formats and auditability
  - Export diff‑only audio (the synthesized replacement clip) per edit.
  - Export subtitles in `.srt` and JSON (words + timings before/after edits).
  - Keep an edit audit log: `{ jobId, edits:[{start,end,oldText,newText,voice,params,timestamp}] }`.

- Multi‑language handling
  - Auto‑detect from STT; pass language to XTTS.
  - UI override for language token when auto is wrong; persist per job.

- Structured job tree (refine)
  - `out/media_edits/<jobId>/`
    - `source.ext`, `source.wav`
    - `stt/transcript.json`, `stt/subtitles.srt`
    - `edits/edit-001/selection.json`, `tts.wav`, `tts_fit.wav`, `diff.wav`, `preview.wav`, `log.json`
    - `final.mp4` (when muxed)

Notes
- The existing XTTS custom voice creation/management flows are reused for voice borrowing.
- Queue integration mirrors synthesis jobs; long steps surface progress in the Results drawer.
