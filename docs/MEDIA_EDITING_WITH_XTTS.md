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
- Modes:
  - Full: refine the entire transcript after first pass (one-time cost; great for multiple edits).
  - Lazy: refine only the selected region with +/- margin on demand (fastest interactive loop).
- Toggle via env: `WHISPERX_ENABLE=1`, runtime UI button available when installed.
 - The launcher now asks at startup whether to enable WhisperX; override by exporting `WHISPERX_ENABLE`/`WHISPERX_DEVICE`, or skip prompts with `SKIP_ASK=1`.
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

---

## Progress (v1 implemented)

- Media Editor subpage
  - Open via Tools → Media Editor or navigate to `#media`.
  - Two‑column layout: controls on the left; transport, timeline, and transcript on the right.

- Transcribe + ETA
  - YouTube: ETA progress bar based on `/api/media/estimate` (duration) and average RTF from `/api/media/stats`.
  - Local file: runs faster‑whisper immediately (no ETA yet).

- Selection + Transport
  - Click/drag to select words; band with playhead shows on a custom timeline under the player.
  - Draggable handles and nudgers (±0.05s) refine Start/End precisely.
  - Play seeks to selection and auto‑stops at end; “Play selection” button included.
  - Replace text auto‑fills from selected words (punctuation‑aware join) and is editable in a large textarea.

- Alignment (optional)
  - WhisperX full or region alignment with ETA; refined word‑level timings improve cut points.

- Voice selection
  - Borrow from selection (default), XTTS voice list, or Favorites (XTTS) directly.

- Replace preview
  - Synth (XTTS) → trim synthesized clip edges (librosa.trim with small pre/post pads) → high‑quality time‑stretch (ffmpeg atempo chain) → loudness match → short crossfades → overlay.
  - Preview player for the patched audio; parameters configurable in the Timing section (Fade, Margin, Trim).

- Apply to final
  - `/api/media/apply` muxes preview audio with the original container (video or audio‑only).
  - Codec selection by container: WebM (libopus, 48 kHz), MP4/MOV (AAC).
  - Copy failure fallback: re‑encode video to VP9 (WebM) or H.264 (MP4/MOV) automatically.

- Robustness + caching
  - YouTube audio cache `out/media_cache/youtube/<id>.*`; avoids 429s and speeds up re‑runs.
  - Absolute media URLs from the UI; audio element reloads metadata on src change.
  - Stats persisted to `out/media_stats.json` (last 100) drive ETAs.

---

## Endpoints (implemented)

- `POST /api/media/transcribe` — Upload or `{ source:'youtube', url }` → transcript with words + `media.audio_url` (WAV).
- `POST /api/media/align` — WhisperX full transcript alignment.
- `POST /api/media/align_region` — WhisperX alignment for a [start,end] window; merges refined words.
- `POST /api/media/replace_preview` — `{ jobId, start, end, text, voice?, marginMs?, fadeMs?, duckDb?, trimEnable?, trimTopDb?, trimPrepadMs?, trimPostpadMs? }` → preview URL.
  - `duckDb` (optional): dB amount to reduce original audio under the replacement (e.g., `-18`). When omitted, the original segment is fully replaced within the region.
- `POST /api/media/apply` — `{ jobId, format? }` → mux final URL; auto codec selection + re‑encode fallback.
- `GET /api/media/stats` — average RTFs from recent runs.
- `POST /api/media/estimate` — `{ source:'youtube', url }` → `{ duration }` used for transcribe ETA.

---

## How to Use (UI)

1) Open Media Editor (Tools → Media Editor).
2) Paste YouTube URL or choose a file; click Transcribe.
   - For YouTube you’ll see an ETA bar; the source player appears on the right.
3) Select words (drag/shift‑click); adjust with timeline handles or nudgers.
   - Replace text auto‑fills from the selection; edit as needed.
4) (Optional) Refine region with WhisperX for tighter cut points.
5) Pick voice (Borrow, XTTS, or Favorite) and adjust Timing (Fade, Trim).
6) Preview replace; if satisfied, Apply to video (or audio‑only when no video).

---

## Timing Details

- Replace pipeline sequence
  1. Trim synthesized clip edges (top_db≈40 dB) with small pre/post pads (default 8 ms) to remove leading/trailing silence.
  2. Time‑stretch with ffmpeg atempo chain to match region length (pitch preserved; chain in [0.5×,2×]).
  3. Loudness match to neighborhood (±0.5 s) by RMS; clamp for stability.
  4. Crossfade (default 30 ms) at entry/exit; overlay and duck original in the region.

- Controls
  - Fade (ms): selection boundary softening.
  - Margin (s): how much of the region to borrow for XTTS reference (when borrowing).
  - Trim dB + Pre/Post pad (ms): synthesized clip edge handling.

---

## Known Issues / Next

- Word selection handles exist; consider keyboard nudges and snapping to word edges.
- Add toast notifications for media load failures and apply re‑encode fallback.
- Favorites voice picker could include search + badges.
- Export before/after subtitles (.srt/.json) and an edit audit log.
