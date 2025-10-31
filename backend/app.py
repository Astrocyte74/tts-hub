from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass
import base64
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Set, Tuple
import random
import re
import time

import numpy as np
import soundfile as sf
import librosa
from flask import Blueprint, Flask, Response, abort, jsonify, make_response, request, send_from_directory
from flask_cors import CORS
from favorites_store import FavoritesStore

try:
    from kokoro_onnx import Kokoro
except ImportError as exc:  # pragma: no cover
    raise RuntimeError(
        "kokoro-onnx is not installed. Run the launcher to create the virtualenv and install dependencies."
    ) from exc

# ---------------------------------------------------------------------------
# Paths & Configuration
# ---------------------------------------------------------------------------

APP_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = Path(os.environ.get("KOKORO_OUT", APP_ROOT / "out")).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PREVIEW_DIR = OUTPUT_DIR / "voice_previews"
PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
DRAWTHINGS_IMAGE_DIR = OUTPUT_DIR / "drawthings_images"
DRAWTHINGS_IMAGE_DIR.mkdir(parents=True, exist_ok=True)

FRONTEND_DIST = Path(os.environ.get("FRONTEND_DIST", APP_ROOT / "frontend" / "dist")).resolve()

MODEL_PATH = Path(os.environ.get("KOKORO_MODEL", str(APP_ROOT / "models" / "kokoro-v1.0.onnx"))).expanduser()
VOICES_PATH = Path(os.environ.get("KOKORO_VOICES", str(APP_ROOT / "models" / "voices-v1.0.bin"))).expanduser()

BACKEND_HOST = os.environ.get("BACKEND_HOST", os.environ.get("HOST", "127.0.0.1"))
BACKEND_PORT = int(os.environ.get("BACKEND_PORT", os.environ.get("PORT", "7860")))
API_PREFIX = os.environ.get("API_PREFIX", os.environ.get("VITE_API_PREFIX", "api")).strip("/")
# Optional launcher-provided hints for client status displays
PUBLIC_HOST = os.environ.get("PUBLIC_HOST")
LAN_IP = os.environ.get("LAN_IP")
FAVORITES_STORE_PATH = Path(
    os.environ.get("FAVORITES_STORE_PATH", str(Path.home() / ".kokoro" / "favorites.json"))
).expanduser()
FAVORITES_API_KEY = os.environ.get("FAVORITES_API_KEY")

TTS_HUB_ROOT = APP_ROOT.parent
XTTS_ROOT = Path(os.environ.get("XTTS_ROOT", TTS_HUB_ROOT / "XTTS")).expanduser()
XTTS_SERVICE_DIR = Path(os.environ.get("XTTS_SERVICE_DIR", XTTS_ROOT / "tts-service")).expanduser()
XTTS_PYTHON = Path(os.environ.get("XTTS_PYTHON", XTTS_SERVICE_DIR / ".venv" / "bin" / "python")).expanduser()
XTTS_VOICE_DIR = Path(os.environ.get("XTTS_VOICE_DIR", XTTS_SERVICE_DIR / "voices")).expanduser()
XTTS_OUTPUT_FORMAT = os.environ.get("XTTS_OUTPUT_FORMAT", "wav").lower()
XTTS_TIMEOUT_SECONDS = float(os.environ.get("XTTS_TIMEOUT", "120"))
XTTS_SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg"}
XTTS_SERVER_URL = os.environ.get("XTTS_SERVER_URL")
YT_DLP_COOKIES_PATH = Path(os.environ.get("YT_DLP_COOKIES_PATH", str(Path.home() / ".kokoro" / "yt_cookies.txt"))).expanduser()
YT_DLP_EXTRACTOR_ARGS = os.environ.get("YT_DLP_EXTRACTOR_ARGS", "")
XTTS_MIN_REF_SECONDS = float(os.environ.get("XTTS_MIN_REF_SECONDS", "5"))
XTTS_MAX_REF_SECONDS = float(os.environ.get("XTTS_MAX_REF_SECONDS", "30"))

# Media artifact cleanup config
MEDIA_TTL_DAYS = float(os.environ.get("MEDIA_TTL_DAYS", "7"))
MEDIA_CLEANUP_INTERVAL_HOURS = float(os.environ.get("MEDIA_CLEANUP_INTERVAL_HOURS", "12"))

# Media edit / STT config
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base").strip()
ALLOW_STUB_STT = os.environ.get("ALLOW_STUB_STT", "1").strip() not in {"0", "false", "False"}
WHISPERX_ENABLE = os.environ.get("WHISPERX_ENABLE", "0").strip() in {"1", "true", "True"}
WHISPERX_DEVICE = os.environ.get("WHISPERX_DEVICE", "mps" if sys.platform == "darwin" else "cpu").strip()
try:  # Optional STT dependency
    from faster_whisper import WhisperModel  # type: ignore
    _have_faster_whisper = True
except Exception:  # pragma: no cover
    WhisperModel = None  # type: ignore
    _have_faster_whisper = False

# Cache a singleton faster-whisper model to avoid reloading per request
_fw_model_lock = threading.Lock()
_fw_model_name: Optional[str] = None
_fw_model: Any = None

try:  # Optional alignment dependency
    import whisperx  # type: ignore

    _have_whisperx = True
except Exception:  # pragma: no cover
    whisperx = None  # type: ignore
    _have_whisperx = False

_xtts_voice_cache: Dict[str, Path] = {}
_xtts_voice_lock = threading.Lock()
_cleanup_lock = threading.Lock()
_last_cleanup_ts: Optional[float] = None

_openvoice_voice_cache: Dict[str, Dict[str, Any]] = {}
_openvoice_voice_lock = threading.Lock()
_openvoice_style_cache: Optional[Dict[str, List[str]]] = None
_openvoice_style_lock = threading.Lock()
_chattts_voice_cache: Dict[str, Dict[str, Any]] = {}
_chattts_voice_lock = threading.Lock()

OPENVOICE_ROOT = Path(os.environ.get("OPENVOICE_ROOT", TTS_HUB_ROOT / "openvoice")).expanduser()
OPENVOICE_PYTHON = Path(os.environ.get("OPENVOICE_PYTHON", OPENVOICE_ROOT / ".venv" / "bin" / "python")).expanduser()
OPENVOICE_CKPT_ROOT = Path(os.environ.get("OPENVOICE_CKPT_ROOT", OPENVOICE_ROOT / "checkpoints")).expanduser()
OPENVOICE_REFERENCE_DIR = Path(os.environ.get("OPENVOICE_REFERENCE_DIR", OPENVOICE_ROOT / "resources")).expanduser()
OPENVOICE_TIMEOUT_SECONDS = float(os.environ.get("OPENVOICE_TIMEOUT", "120"))
OPENVOICE_WATERMARK = os.environ.get("OPENVOICE_WATERMARK", "@MyShell")
OPENVOICE_SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg"}

CHATTT_ROOT = Path(os.environ.get("CHATTT_ROOT", TTS_HUB_ROOT / "chattts")).expanduser()
CHATTT_PYTHON = Path(os.environ.get("CHATTT_PYTHON", CHATTT_ROOT / ".venv" / "bin" / "python")).expanduser()
CHATTT_TIMEOUT_SECONDS = float(os.environ.get("CHATTT_TIMEOUT", "120"))
CHATTT_SOURCE = os.environ.get("CHATTT_SOURCE", "local")
CHATTT_SUPPORTED_EXTENSIONS = {".mp3"}
CHATTT_PRESET_DIR = Path(os.environ.get("CHATTT_PRESET_DIR", CHATTT_ROOT / "presets")).expanduser()

# ---------------------------------------------------------------------------
# Custom error
# ---------------------------------------------------------------------------


class PlaygroundError(Exception):
    """Raise for user-facing errors that should become JSON responses."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------------------
# Media edit helpers (extract + STT)
# ---------------------------------------------------------------------------


def _ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def _media_job_dir(job_id: str) -> Path:
    d = OUTPUT_DIR / "media_edits" / job_id
    _ensure_dir(d)
    return d



def _ffprobe_duration_seconds(path: Path) -> float:
    try:
        proc = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        return float((proc.stdout or "0").strip() or 0)
    except Exception:
        return 0.0


def _ffprobe_has_video(path: Path) -> bool:
    """Return True if the media file contains at least one video stream."""
    try:
        proc = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "csv=p=0",
                str(path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        out = (proc.stdout or "").strip()
        return bool(out)
    except Exception:
        return False


def _log(msg: str) -> None:
    print(f"[media] {msg}")


def _record_stat(kind: str, sample: Dict[str, Any]) -> None:
    """Append a small stat sample to out/media_stats.json (kept to last 100 entries per kind)."""
    stats_path = OUTPUT_DIR / "media_stats.json"
    try:
        data: Dict[str, Any] = {}
        if stats_path.exists():
            data = json.loads(stats_path.read_text(encoding="utf-8"))
        if kind not in data or not isinstance(data.get(kind), list):
            data[kind] = []
        data[kind].append(sample)
        # Keep bounded history
        if len(data[kind]) > 100:
            data[kind] = data[kind][-100:]
        stats_path.parent.mkdir(parents=True, exist_ok=True)
        stats_path.write_text(json.dumps(data), encoding="utf-8")
    except Exception:
        pass


def _alignment_diff_stats(prev_words: List[Dict[str, Any]], new_words: List[Dict[str, Any]], *, window: Optional[Tuple[float, float]] = None) -> Dict[str, Any]:
    """Compute numerical differences between previous and new word timings.

    Returns counts and aggregate absolute deltas (ms) for start/end boundaries.
    If window=(start,end) is provided, only words overlapping that time range are compared.
    """
    try:
        # Optionally subset by window
        if window is not None:
            ws, we = float(window[0]), float(window[1])
            def _in_win(w: Dict[str, Any]) -> bool:
                try:
                    return float(w.get('end', 0) or 0) > ws and float(w.get('start', 0) or 0) < we
                except Exception:
                    return False
            prev = [w for w in prev_words if _in_win(w)]
            new = [w for w in new_words if _in_win(w)]
        else:
            prev, new = prev_words, new_words

        n = min(len(prev), len(new))
        if n == 0:
            return {"compared": 0}
        abs_deltas: List[float] = []
        tops: List[Dict[str, Any]] = []
        changed = 0
        text_mismatch = 0
        for i in range(n):
            p = prev[i]; q = new[i]
            try:
                ps = float(p.get('start', 0) or 0); pe = float(p.get('end', 0) or 0)
                qs = float(q.get('start', 0) or 0); qe = float(q.get('end', 0) or 0)
            except Exception:
                continue
            pt = str(p.get('text') or p.get('word') or '').strip()
            qt = str(q.get('text') or q.get('word') or '').strip()
            if pt != qt:
                text_mismatch += 1
            ds = abs(qs - ps); de = abs(qe - pe)
            if ds > 1e-6 or de > 1e-6:
                changed += 1
            # consider boundary delta as the larger of start/end
            chosen = 'start' if ds >= de else 'end'
            dval = ds if chosen == 'start' else de
            abs_deltas.append(dval)
            # record candidate for top list (skip text mismatches)
            if pt == qt:
                if chosen == 'start':
                    direction = 'later' if qs > ps else 'earlier'
                    delta_ms = (qs - ps) * 1000.0
                    tops.append({'idx': i, 'text': qt, 'boundary': 'start', 'delta_ms': delta_ms, 'start_prev': ps, 'start_new': qs})
                else:
                    direction = 'later' if qe > pe else 'earlier'
                    delta_ms = (qe - pe) * 1000.0
                    tops.append({'idx': i, 'text': qt, 'boundary': 'end', 'delta_ms': delta_ms, 'end_prev': pe, 'end_new': qe})
        abs_ms = [d * 1000.0 for d in abs_deltas]
        abs_ms_sorted = sorted(abs_ms)
        def _pct(p: float) -> float:
            if not abs_ms_sorted:
                return 0.0
            k = max(0, min(len(abs_ms_sorted)-1, int(round(p * (len(abs_ms_sorted)-1)))))
            return float(abs_ms_sorted[k])
        mean = sum(abs_ms) / len(abs_ms) if abs_ms else 0.0
        med = _pct(0.5)
        p95 = _pct(0.95)
        mx = abs_ms_sorted[-1] if abs_ms_sorted else 0.0
        return {
            "compared": n,
            "changed": changed,
            "text_mismatch": text_mismatch,
            "mean_abs_ms": mean,
            "median_abs_ms": med,
            "p95_abs_ms": p95,
            "max_abs_ms": mx,
            "top": sorted([
                {
                    'idx': t.get('idx'),
                    'text': t.get('text'),
                    'boundary': t.get('boundary'),
                    'delta_ms': float(t.get('delta_ms') or 0.0),
                    'direction': ('later' if float(t.get('delta_ms') or 0.0) > 0 else 'earlier')
                }
                for t in tops
            ], key=lambda r: abs(float(r.get('delta_ms') or 0.0)), reverse=True)[:10]
        }
    except Exception:
        return {"compared": 0}


def _maybe_cleanup_media_artifacts() -> None:
    """Delete old media artifacts in out/media_edits and out/media_cache based on TTL.

    Runs at most once per MEDIA_CLEANUP_INTERVAL_HOURS.
    """
    global _last_cleanup_ts
    try:
        now = time.time()
        with _cleanup_lock:
            if _last_cleanup_ts is not None:
                if (now - _last_cleanup_ts) < (MEDIA_CLEANUP_INTERVAL_HOURS * 3600.0):
                    return
            _last_cleanup_ts = now

        ttl_seconds = MEDIA_TTL_DAYS * 86400.0
        # Clean media_edits job directories
        edits_root = OUTPUT_DIR / "media_edits"
        if edits_root.exists():
            for child in edits_root.iterdir():
                try:
                    if not child.is_dir():
                        continue
                    # Compute newest mtime within the directory
                    newest = child.stat().st_mtime
                    for p in child.rglob("*"):
                        try:
                            newest = max(newest, p.stat().st_mtime)
                        except Exception:
                            pass
                    if (now - newest) > ttl_seconds:
                        shutil.rmtree(child, ignore_errors=True)
                        _log(f"Cleanup: removed old media job '{child.name}'")
                except Exception:
                    pass

        # Clean YouTube cache files
        yt_root = OUTPUT_DIR / "media_cache" / "youtube"
        if yt_root.exists():
            for f in yt_root.glob("*"):
                try:
                    if not f.is_file():
                        continue
                    age = now - f.stat().st_mtime
                    if age > ttl_seconds:
                        f.unlink(missing_ok=True)
                        _log(f"Cleanup: removed old YouTube cache '{f.name}'")
                except Exception:
                    pass
    except Exception:
        # Never raise from cleanup
        pass


def _transcribe_faster_whisper(audio_wav: Path) -> Dict[str, Any]:
    if not _have_faster_whisper or WhisperModel is None:  # type: ignore[name-defined]
        raise PlaygroundError("STT 'faster-whisper' is not available on this host.", status=503)
    # Lazy init model with CPU-friendly defaults (cached singleton)
    global _fw_model, _fw_model_name
    with _fw_model_lock:
        if _fw_model is None or _fw_model_name != WHISPER_MODEL:
            _fw_model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")  # type: ignore[call-arg]
            _fw_model_name = WHISPER_MODEL
        model = _fw_model
    _log(f"STT faster-whisper: transcribing wav='{audio_wav}'")
    t0 = time.time()
    segments, info = model.transcribe(str(audio_wav), vad_filter=True, word_timestamps=True)
    words: List[Dict[str, Any]] = []
    segs: List[Dict[str, Any]] = []
    for seg in segments:
        segs.append({"text": seg.text, "start": float(seg.start or 0), "end": float(seg.end or 0)})
        if getattr(seg, "words", None):
            for w in seg.words or []:
                words.append({
                    "text": w.word.strip(),
                    "start": float(w.start or 0),
                    "end": float(w.end or 0),
                    "confidence": float(getattr(w, "probability", 0) or 0),
                })
    elapsed = max(time.time() - t0, 1e-6)
    dur = _ffprobe_duration_seconds(audio_wav)
    rtf = (dur / elapsed) if elapsed > 0 else 0
    result = {
        "language": getattr(info, "language", "unknown"),
        "duration": dur,
        "segments": segs,
        "words": words,
        "stats": {"elapsed": elapsed, "rtf": rtf, "segments": len(segs), "words": len(words)},
    }
    _log(f"STT faster-whisper: done lang={result['language']} segs={len(segs)} words={len(words)} elapsed={elapsed:.2f}s rtf={rtf:.2f}x")
    return result


def _transcribe_stub(audio_wav: Path) -> Dict[str, Any]:
    dur = _ffprobe_duration_seconds(audio_wav)
    # Create 10 evenly-spaced placeholder words as a stub
    n = 10 if dur > 0 else 0
    words = []
    for i in range(n):
        start = (dur * i) / max(n, 1)
        end = (dur * (i + 1)) / max(n, 1)
        words.append({"text": f"word{i+1}", "start": start, "end": end, "confidence": 0})
    return {
        "language": "unknown",
        "duration": dur,
        "segments": [{"text": "(stub transcript)", "start": 0, "end": dur}],
        "words": words,
        "note": "STT engine unavailable; returning stub for UI development.",
    }


_whisperx_align_cache: Dict[str, Tuple[object, object]] = {}


def _whisperx_get_align_model(language: str) -> Tuple[object, object]:
    if not _have_whisperx or whisperx is None:  # type: ignore[name-defined]
        raise PlaygroundError("WhisperX is not installed on this host.", status=503)
    lang = (language or "en").split("-")[0]
    if lang in _whisperx_align_cache:
        return _whisperx_align_cache[lang]
    align_model, metadata = whisperx.load_align_model(
        language_code=lang,
        device=WHISPERX_DEVICE,
    )
    _whisperx_align_cache[lang] = (align_model, metadata)
    return align_model, metadata


def _whisperx_align_full(audio_wav: Path, transcript: Dict[str, Any]) -> Dict[str, Any]:
    if not _have_whisperx or whisperx is None:  # type: ignore[name-defined]
        raise PlaygroundError("WhisperX is not installed on this host.", status=503)
    language = str(transcript.get("language") or "en")
    align_model, metadata = _whisperx_get_align_model(language)
    # Convert to WhisperX format result
    wx_result: Dict[str, Any] = {
        "language": language,
        "segments": [
            {"text": s.get("text", ""), "start": float(s.get("start", 0.0)), "end": float(s.get("end", 0.0))}
            for s in transcript.get("segments", [])
        ],
    }
    aligned = whisperx.align(
        wx_result["segments"],
        align_model,
        metadata,
        str(audio_wav),
        device=WHISPERX_DEVICE,
        return_char_alignments=False,
    )
    # Flatten words across segments
    words: List[Dict[str, Any]] = []
    for seg in aligned.get("segments", []):
        for w in seg.get("words", []) or []:
            if not isinstance(w, dict):
                continue
            words.append(
                {
                    "text": str(w.get("word") or w.get("text") or "").strip(),
                    "start": float(w.get("start") or 0),
                    "end": float(w.get("end") or 0),
                    "confidence": float(w.get("score") or 0),
                }
            )
    out = dict(transcript)
    out["words"] = words
    out["aligned"] = True
    return out


def _extract_input_to_wav(temp_src: Path, out_wav: Path, *, start: Optional[float] = None, end: Optional[float] = None) -> None:
    # Reuse existing normalisation helper if present; fall back to ffmpeg call
    try:
        _ffmpeg_normalise_to_wav(temp_src, out_wav, start=start, end=end)  # type: ignore[name-defined]
        return
    except Exception:
        pass
    # Fallback normalise: mono 24kHz wav, trim optional
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(temp_src),
    ]
    if start is not None:
        cmd += ["-ss", str(start)]
    if end is not None:
        cmd += ["-to", str(end)]
    cmd += [
        "-ac",
        "1",
        "-ar",
        "24000",
        str(out_wav),
    ]
    _log(f"ffmpeg normalize->wav: src='{temp_src}' out='{out_wav}' ss={start} to={end}")
    subprocess.run(cmd, check=True)


    


# ---------------------------------------------------------------------------
# Kokoro helpers
# ---------------------------------------------------------------------------

_tts_instance: Optional[Kokoro] = None
_tts_lock = threading.Lock()


def get_tts() -> Kokoro:
    global _tts_instance
    if _tts_instance is None:
        with _tts_lock:
            if _tts_instance is None:
                if not MODEL_PATH.exists():
                    raise PlaygroundError(
                        f"TTS model not found at {MODEL_PATH}. Set KOKORO_MODEL to the ONNX path.",
                        status=500,
                    )
                if not VOICES_PATH.exists():
                    raise PlaygroundError(
                        f"Voice bank not found at {VOICES_PATH}. Set KOKORO_VOICES to the voices bin.",
                        status=500,
                    )
                _tts_instance = Kokoro(str(MODEL_PATH), str(VOICES_PATH))
    return _tts_instance


@dataclass
class VoiceProfile:
    id: str
    label: str
    locale: Optional[str]
    gender: Optional[str]
    tags: List[str]
    notes: Optional[str] = None
    accent_id: str = "other"
    accent_label: str = "Other / Mixed"
    accent_flag: str = "🌐"


_cached_voices: Optional[List[VoiceProfile]] = None
_voices_lock = threading.Lock()


def derive_locale_from_id(voice_id: str) -> Optional[str]:
    token = voice_id.split("_", maxsplit=1)[0]
    if len(token) == 2:
        mapping = {
            "af": "en-us",
            "am": "en-us",
            "bf": "en-us",
            "cf": "en-us",
            "df": "en-us",
            "ef": "en-us",
            "gf": "en-us",
            "hf": "en-us",
            "if": "en-us",
            "jf": "en-us",
            "kf": "en-us",
            "lf": "en-us",
            "mf": "en-us",
            "nf": "en-us",
            "pf": "en-us",
            "rf": "en-us",
            "sf": "en-us",
            "tf": "en-us",
            "vf": "en-us",
        }
        return mapping.get(token)
    return None


def derive_gender_from_id(voice_id: str) -> Optional[str]:
    token = voice_id.split("_", maxsplit=1)[0]
    if len(token) >= 2:
        c = token[1].lower()
        if c == "f":
            return "female"
        if c == "m":
            return "male"
    return None


def resolve_accent(voice_id: str, locale: Optional[str]) -> Tuple[str, str, str]:
    prefix = voice_id.split("_", 1)[0][:2].lower()
    if prefix in ACCENT_PREFIX_MAP:
        return ACCENT_PREFIX_MAP[prefix]

    if locale:
        locale_key = locale.lower()
        if locale_key in ACCENT_LOCALE_MAP:
            return ACCENT_LOCALE_MAP[locale_key]
        base_lang = locale_key.split("-")[0]
        if base_lang in ACCENT_LOCALE_MAP:
            return ACCENT_LOCALE_MAP[base_lang]

    return DEFAULT_ACCENT


def load_voice_profiles() -> List[VoiceProfile]:
    global _cached_voices
    if _cached_voices is not None:
        return _cached_voices

    with _voices_lock:
        if _cached_voices is not None:
            return _cached_voices

        if not VOICES_PATH.exists():
            raise PlaygroundError(
                f"Voice bank not found at {VOICES_PATH}. Set KOKORO_VOICES to the voices bin.",
                status=500,
            )

        voices: List[VoiceProfile] = []
        with np.load(VOICES_PATH) as archive:
            for key in sorted(archive.files):
                locale = derive_locale_from_id(key)
                gender = derive_gender_from_id(key)
                accent_id, accent_label, accent_flag = resolve_accent(key, locale)
                voices.append(
                    VoiceProfile(
                        id=key,
                        label=key.replace("_", " ").title(),
                        locale=locale,
                        gender=gender,
                        tags=[],
                        accent_id=accent_id,
                        accent_label=accent_label,
                        accent_flag=accent_flag,
                    )
                )

        _cached_voices = voices
        return voices


def serialise_voice_profile(voice: VoiceProfile) -> Dict[str, Any]:
    # Attach preview_url if a cached preview exists
    engine = "kokoro"
    preview_language = (voice.locale or "en-us").lower()
    preview_path = _preview_path(engine, voice.id, preview_language)
    raw: Dict[str, Any] = {}
    if preview_path.exists():
        relative = preview_path.relative_to(OUTPUT_DIR)
        raw["preview_url"] = f"/audio/{relative.as_posix()}"

    return {
        "id": voice.id,
        "label": voice.label,
        "locale": voice.locale,
        "gender": voice.gender,
        "tags": voice.tags,
        "notes": voice.notes,
        "engine": "kokoro",
        "accent": {
            "id": voice.accent_id,
            "label": voice.accent_label,
            "flag": voice.accent_flag,
        },
        "raw": raw,
    }


def build_voice_groups(voices: List[VoiceProfile]) -> List[Dict[str, Any]]:
    grouped: Dict[str, List[VoiceProfile]] = {}
    for voice in voices:
        key = voice.locale or "misc"
        grouped.setdefault(key, []).append(voice)

    groups: List[Dict[str, Any]] = []
    for locale in sorted(grouped.keys()):
        members = sorted(grouped[locale], key=lambda profile: profile.label.lower())
        groups.append(
            {
                "id": locale,
                "label": locale.upper() if locale != "misc" else "Miscellaneous",
                "count": len(members),
                "voices": [profile.id for profile in members],
            }
        )
    return groups


def group_voices_by_accent(voices: List[VoiceProfile]) -> List[Dict[str, Any]]:
    groups: Dict[str, Dict[str, Any]] = {}

    for voice in voices:
        key = voice.accent_id or "other"
        bucket = groups.setdefault(
            key,
            {
                "id": key,
                "label": voice.accent_label,
                "flag": voice.accent_flag,
                "voices": [],
            },
        )
        bucket["voices"].append(voice.id)

    for bucket in groups.values():
        bucket["count"] = len(bucket["voices"])

    return sorted(groups.values(), key=lambda item: item["label"].lower())


def _family_id_from_accent(accent_id: Optional[str]) -> str:
    if not accent_id:
        return "other"
    return accent_id.split("_", 1)[0]


def _family_label(label: Optional[str], *, default: str = "Other") -> str:
    if not label:
        return default
    # Strip gender suffix like "USA · Female"
    base = str(label).split(" · ", 1)[0].strip()
    return base or default


def build_accent_families(voices: List[Any]) -> Dict[str, List[Dict[str, Any]]]:
    """Collapse gendered accent buckets into families with per-gender counts.

    Accepts either VoiceProfile objects or dicts with shape from serialise_voice_profile.
    Returns a dict with keys: any, female, male — each a list of { id, label, flag, count }.
    """
    from collections import defaultdict

    def get_accent(v: Any) -> Tuple[str, str, str]:
        if isinstance(v, dict):
            a = v.get("accent") or {}
            return str(a.get("id") or "other"), str(a.get("label") or "Other"), str(a.get("flag") or "🌐")
        return getattr(v, "accent_id", "other"), getattr(v, "accent_label", "Other"), getattr(v, "accent_flag", "🌐")

    def get_gender(v: Any) -> Optional[str]:
        return (v.get("gender") if isinstance(v, dict) else getattr(v, "gender", None)) or None

    meta: Dict[str, Dict[str, Any]] = {}
    counts: Dict[str, Dict[str, int]] = defaultdict(lambda: {"any": 0, "female": 0, "male": 0})

    for v in voices:
        aid, alabel, aflag = get_accent(v)
        fam = _family_id_from_accent(aid)
        base_label = _family_label(alabel)
        meta.setdefault(fam, {"id": fam, "label": base_label, "flag": aflag})
        counts[fam]["any"] += 1
        g = get_gender(v)
        if g == "female":
            counts[fam]["female"] += 1
        elif g == "male":
            counts[fam]["male"] += 1

    def to_list(key: str) -> List[Dict[str, Any]]:
        items = []
        for fam, m in meta.items():
            c = counts[fam].get(key, 0)
            if c > 0:
                items.append({"id": fam, "label": m["label"], "flag": m["flag"], "count": c})
        items.sort(key=lambda x: x["label"].lower())
        return items

    return {"any": to_list("any"), "female": to_list("female"), "male": to_list("male")}



def build_kokoro_voice_payload() -> Dict[str, Any]:
    voices = load_voice_profiles()
    accent_groups = group_voices_by_accent(voices)
    accent_families = build_accent_families(voices)
    # Build filter helpers (gender & locale counts)
    from collections import Counter
    genders = Counter((v.gender or "unknown") for v in voices)
    locales = Counter((v.locale or "misc") for v in voices)
    gender_filters = [
        {"id": k, "label": ("Female" if k=="female" else "Male" if k=="male" else "Unknown"), "count": c}
        for k, c in sorted(genders.items())
    ]
    locale_filters = [
        {"id": k, "label": (k.upper() if k != "misc" else "Miscellaneous"), "count": c}
        for k, c in sorted(locales.items())
    ]

    return {
        "engine": "kokoro",
        "available": MODEL_PATH.exists() and VOICES_PATH.exists(),
        "voices": [serialise_voice_profile(voice) for voice in voices],
        "accentGroups": accent_groups,
        "groups": accent_groups,
        "count": len(voices),
        "filters": {
            "genders": gender_filters,
            "locales": locale_filters,
            "accents": accent_groups,
            "accentFamilies": accent_families,
        },
    }

## voices_catalog endpoint moved below after blueprint declaration


# ---------------------------------------------------------------------------
# Preview generation (Phase 3)
# ---------------------------------------------------------------------------

def _preview_key(engine: str, voice_id: str, language: str) -> str:
    version = "v1"
    return f"{voice_id}-{language}-{version}"


def _preview_path(engine: str, voice_id: str, language: str) -> Path:
    key = _preview_key(engine, voice_id, language)
    return PREVIEW_DIR / engine / f"{key}.wav"


def _ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def _default_preview_text(language: Optional[str]) -> str:
    # Keep short, neutral content; fall back to English
    lang = (language or "en-us").lower()
    mapping = {
        "en-us": "Welcome to the Kokoro Playground. This is a short preview.",
        "en-gb": "Welcome to the Kokoro Playground. This is a short preview.",
        "ja-jp": "ココロ・プレイグラウンドへようこそ。これは短いプレビューです。",
    }
    return mapping.get(lang, mapping["en-us"])


def _preview_language_key(language: Optional[str], *, fallback: str = "default") -> str:
    if not language:
        return fallback
    value = str(language).strip().lower()
    return value or fallback


def _find_cached_preview(engine: str, voice_id: str) -> Optional[str]:
    engine_dir = PREVIEW_DIR / engine
    if not engine_dir.exists():
        return None
    pattern = f"{voice_id}-*-v1.wav"
    for candidate in sorted(engine_dir.glob(pattern)):
        try:
            relative = candidate.relative_to(OUTPUT_DIR)
        except ValueError:
            continue
        return f"/audio/{relative.as_posix()}"
    return None


def _fade_and_trim(audio: np.ndarray, sr: int, *, max_seconds: float = 5.0) -> np.ndarray:
    target_len = min(len(audio), int(sr * max_seconds))
    if target_len <= 0:
        return audio
    clipped = audio[:target_len].astype(np.float32)
    # Fade out last 50ms
    fade = int(sr * 0.05)
    if fade > 0 and len(clipped) > fade:
        window = np.linspace(1.0, 0.0, fade, dtype=np.float32)
        clipped[-fade:] *= window
    # Normalize gently
    peak = float(np.max(np.abs(clipped))) if clipped.size else 0.0
    if peak > 0:
        clipped = (clipped / peak) * 0.95
    return clipped


def _load_audio_for_preview(source_path: Path) -> Tuple[np.ndarray, int]:
    ext = source_path.suffix.lower()
    if ext in {".wav", ".flac", ".ogg"}:
        data, sr = sf.read(source_path, always_2d=False)
        if isinstance(data, np.ndarray):
            if data.ndim > 1:
                data = data.mean(axis=1)
            data = data.astype(np.float32, copy=False)
        else:
            data = np.asarray(data, dtype=np.float32)
        return data, int(sr)
    audio, sr = librosa.load(str(source_path), sr=None, mono=True)
    return np.asarray(audio, dtype=np.float32), int(sr)


def _resolve_result_audio_path(result: Dict[str, Any]) -> Path:
    candidates: List[str] = []
    for key in ("filename", "file", "clip"):
        value = result.get(key)
        if isinstance(value, str) and value:
            candidates.append(value)
    path_like = result.get("path") or result.get("url") or result.get("audio_url")
    if isinstance(path_like, str) and path_like:
        candidates.append(path_like)
    for entry in candidates:
        text = entry.strip()
        if not text:
            continue
        if text.startswith("/audio/"):
            name = text.rsplit("/", 1)[-1]
            candidate = OUTPUT_DIR / name
        else:
            candidate_path = Path(text)
            if candidate_path.is_absolute():
                candidate = candidate_path
            else:
                candidate = OUTPUT_DIR / candidate_path.name
        if candidate.exists():
            return candidate.resolve()
    raise PlaygroundError("Preview generation failed: output file not found.", status=500)


def _write_preview_from_file(engine: str, voice_id: str, language_key: str, source_path: Path) -> Path:
    audio, sr = _load_audio_for_preview(source_path)
    processed = _fade_and_trim(audio, sr, max_seconds=5.0)
    target_path = _preview_path(engine, voice_id, language_key)
    _ensure_parent(target_path)
    sf.write(target_path, processed, sr)
    return target_path


def _get_or_create_kokoro_preview(voice_id: str, language: Optional[str], *, force: bool = False, **_: Any) -> Path:
    lang_value = language or "en-us"
    lang_key = _preview_language_key(lang_value, fallback="en-us")
    path = _preview_path("kokoro", voice_id, lang_key)
    if path.exists() and not force:
        return path
    tts = get_tts()
    text = _default_preview_text(lang_value)
    audio, sr = tts.create(text, voice=voice_id, speed=1.0, lang=lang_value, trim=True)
    audio = np.squeeze(audio).astype(np.float32)
    processed = _fade_and_trim(audio, sr, max_seconds=5.0)
    _ensure_parent(path)
    sf.write(path, processed, sr)
    return path


def _get_or_create_xtts_preview(voice_id: str, language: Optional[str], *, force: bool = False, **options: Any) -> Path:
    lang_value = language or options.get("language") or "en-us"
    language_key = _preview_language_key(lang_value, fallback="default")
    path = _preview_path("xtts", voice_id, language_key)
    if path.exists() and not force:
        return path
    payload: Dict[str, Any] = {
        "text": _default_preview_text(lang_value),
        "voice": voice_id,
        "language": lang_value,
        "speed": options.get("speed", 1.0),
        "trimSilence": True,
    }
    if options.get("temperature") is not None:
        payload["temperature"] = options["temperature"]
    if options.get("seed") is not None:
        payload["seed"] = options["seed"]
    if options.get("format"):
        payload["format"] = options["format"]
    if options.get("sample_rate"):
        payload["sample_rate"] = options["sample_rate"]
    data = _xtts_prepare_payload(payload)
    result = _xtts_synthesise(data)
    source_path = _resolve_result_audio_path(result)
    try:
        preview_path = _write_preview_from_file("xtts", voice_id, language_key, source_path)
    finally:
        try:
            source_path.unlink()
        except OSError:
            pass
    return preview_path


def _get_or_create_openvoice_preview(voice_id: str, language: Optional[str], *, force: bool = False, **options: Any) -> Path:
    voice_map = get_openvoice_voice_map()
    meta = voice_map.get(voice_id)
    if meta is None:
        raise PlaygroundError(f"Unknown OpenVoice reference '{voice_id}'.", status=400)
    language_value = options.get("language") or language or meta.get("language") or "English"
    style_value = options.get("style") or meta.get("style") or "default"
    language_key = _preview_language_key(language_value, fallback="default")
    path = _preview_path("openvoice", voice_id, language_key)
    if path.exists() and not force:
        return path
    payload: Dict[str, Any] = {
        "text": _default_preview_text("en-us"),
        "voice": voice_id,
        "language": language_value,
        "style": style_value,
        "trimSilence": True,
    }
    data = _openvoice_prepare_payload(payload)
    result = _openvoice_synthesise(data)
    source_path = _resolve_result_audio_path(result)
    try:
        preview_path = _write_preview_from_file("openvoice", voice_id, language_key, source_path)
    finally:
        try:
            source_path.unlink()
        except OSError:
            pass
    return preview_path


def _get_or_create_chattts_preview(voice_id: str, language: Optional[str], *, force: bool = False, **options: Any) -> Path:
    language_value = options.get("language") or language or "en-us"
    language_key = _preview_language_key(language_value, fallback="default")
    path = _preview_path("chattts", voice_id, language_key)
    if path.exists() and not force:
        return path
    payload: Dict[str, Any] = {
        "text": _default_preview_text(language_value),
        "voice": voice_id,
        "language": language_value,
        "trimSilence": True,
    }
    if options.get("seed") is not None:
        payload["seed"] = options["seed"]
    data = _chattts_prepare_payload(payload)
    try:
        result = _chattts_synthesise(data)
    except PlaygroundError as exc:
        message = str(exc)
        if data.get("speaker") and "--spk" in message:
            fallback = dict(data)
            fallback.pop("speaker", None)
            result = _chattts_synthesise(fallback)
        else:
            raise
    source_path = _resolve_result_audio_path(result)
    try:
        preview_path = _write_preview_from_file("chattts", voice_id, language_key, source_path)
    finally:
        try:
            source_path.unlink()
        except OSError:
            pass
    return preview_path


def _normalise_chattts_speaker(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    candidate = str(value).strip()
    if not candidate:
        return None
    candidate = candidate.replace("\n", " ").strip()
    # take first token to avoid CLI argument parsing issues with descriptive strings
    parts = candidate.split()
    if parts:
        candidate = parts[0]
    candidate = candidate.strip(".,;:!\"'")
    return candidate or None


PREVIEW_GENERATORS: Dict[str, Callable[..., Path]] = {
    "kokoro": _get_or_create_kokoro_preview,
    "xtts": _get_or_create_xtts_preview,
    "openvoice": _get_or_create_openvoice_preview,
    "chattts": _get_or_create_chattts_preview,
}


## preview route defined later (after api blueprint is declared)


def _slugify_voice_id(name: str) -> str:
    slug_chars: list[str] = []
    for char in name.lower():
        if char.isalnum():
            slug_chars.append(char)
        elif char in {' ', '-', '_'}:
            slug_chars.append('_')
    slug = ''.join(slug_chars).strip('_')
    return slug or name.lower()


def _have_tool(name: str) -> bool:
    try:
        return shutil.which(name) is not None
    except Exception:
        return False


def _parse_timecode(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            v = float(value)
            return v if v >= 0 else None
        except Exception:
            return None
    s = str(value).strip()
    if not s:
        return None
    # mm:ss or hh:mm:ss
    if ":" in s:
        parts = s.split(":")
        try:
            parts = [float(p) for p in parts]
        except Exception:
            return None
        if len(parts) == 2:
            m, sec = parts
            return max(0.0, m * 60.0 + sec)
        if len(parts) == 3:
            h, m, sec = parts
            return max(0.0, h * 3600.0 + m * 60.0 + sec)
        return None
    try:
        return max(0.0, float(s))
    except Exception:
        return None


def _probe_duration_seconds(path: Path) -> float:
    try:
        with sf.SoundFile(str(path)) as f:
            return float(len(f)) / float(f.samplerate)
    except Exception:
        try:
            # librosa fallback
            return float(librosa.get_duration(path=str(path)))
        except Exception as exc:
            raise PlaygroundError(f"Failed to read audio duration: {exc}", status=400)


def _ffmpeg_normalise_to_wav(src: Path, dst: Path, *, start: Optional[float] = None, end: Optional[float] = None) -> None:
    if not _have_tool("ffmpeg"):
        raise PlaygroundError("ffmpeg is required to process audio. Install ffmpeg and try again.", status=503)
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd: List[str] = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    if start is not None and start > 0:
        cmd += ["-ss", f"{start}"]
    cmd += ["-i", str(src)]
    if end is not None and end > 0:
        if start is not None and end > start:
            cmd += ["-t", f"{end - start}"]
        else:
            cmd += ["-to", f"{end}"]
    # mono, 24kHz, keep volume safe
    cmd += ["-ac", "1", "-ar", "24000", "-vn", str(dst)]
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as exc:
        raise PlaygroundError(f"ffmpeg failed to process audio: {exc}", status=500)


def _unique_xtts_filename(slug: str, ext: str = ".wav") -> Path:
    directory = XTTS_VOICE_DIR
    directory.mkdir(parents=True, exist_ok=True)
    candidate = directory / f"{slug}{ext}"
    if not candidate.exists():
        return candidate
    i = 2
    while True:
        alt = directory / f"{slug}_{i}{ext}"
        if not alt.exists():
            return alt
        i += 1


def get_xtts_voice_map() -> Dict[str, Path]:
    voice_dir = XTTS_VOICE_DIR
    mapping: Dict[str, Path] = {}
    if voice_dir.exists():
        for path in sorted(voice_dir.iterdir()):
            if not path.is_file():
                continue
            if path.suffix.lower() not in XTTS_SUPPORTED_EXTENSIONS:
                continue
            base_id = _slugify_voice_id(path.stem)
            unique_id = base_id
            counter = 1
            while unique_id in mapping:
                counter += 1
                unique_id = f"{base_id}_{counter}"
            mapping[unique_id] = path.resolve()
    with _xtts_voice_lock:
        _xtts_voice_cache.clear()
        _xtts_voice_cache.update(mapping)
    return dict(mapping)


def build_xtts_voice_payload() -> Dict[str, Any]:
    mapping = get_xtts_voice_map()
    voices: List[Dict[str, Any]] = []
    for voice_id, voice_path in mapping.items():
        label = voice_path.stem.replace('_', ' ').title()
        preview_url = _find_cached_preview("xtts", voice_id)
        # Load sidecar metadata if present
        sidecar_path = voice_path.with_suffix('.meta.json')
        sidecar: Dict[str, Any] = {}
        if sidecar_path.exists():
            try:
                with sidecar_path.open('r', encoding='utf-8') as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        sidecar = data
            except Exception:
                sidecar = {}
        # Normalise metadata
        locale = None
        gender = None
        tags: List[str] = []
        notes = voice_path.name
        accent = {'id': 'custom', 'label': 'Custom Voice', 'flag': '🎙️'}
        if sidecar:
            lang_value = sidecar.get('language')
            if isinstance(lang_value, str) and lang_value.strip():
                locale = lang_value.strip().lower()
            gender_value = sidecar.get('gender')
            if isinstance(gender_value, str) and gender_value.strip():
                g = gender_value.strip().lower()
                if g in {'female', 'male', 'unknown'}:
                    gender = g
            tags_value = sidecar.get('tags')
            if isinstance(tags_value, list):
                tags = [str(t) for t in tags_value if str(t).strip()]
            notes_value = sidecar.get('notes')
            if isinstance(notes_value, str) and notes_value.strip():
                notes = notes_value.strip()
            acc_value = sidecar.get('accent')
            if isinstance(acc_value, dict):
                acc_id = str(acc_value.get('id') or 'custom')
                acc_label = str(acc_value.get('label') or 'Custom Voice')
                acc_flag = str(acc_value.get('flag') or '🎙️')
                accent = {'id': acc_id, 'label': acc_label, 'flag': acc_flag}

        raw: Dict[str, Any] = {
            'engine': 'xtts',
            'path': str(voice_path),
        }
        if preview_url:
            raw['preview_url'] = preview_url
        # Include a hint of sidecar on raw for clients that need it
        if sidecar:
            raw['meta'] = sidecar
        voices.append(
            {
                'id': voice_id,
                'label': label,
                'locale': locale,
                'gender': gender,
                'tags': tags,
                'notes': notes,
                'accent': accent,
                'raw': raw,
            }
        )
    groups: List[Dict[str, Any]] = []
    if voices:
        groups.append(
            {
                'id': 'xtts_custom',
                'label': 'XTTS Voices',
                'flag': '🎙️',
                'voices': [voice['id'] for voice in voices],
                'count': len(voices),
            }
        )
    message = None
    if not voices:
        message = 'Place reference clips in XTTS/tts-service/voices/ and reload.'
    # Reflect engine availability based on server or local CLI presence, regardless of whether voices exist
    available = bool(XTTS_SERVER_URL) or (XTTS_PYTHON.exists() and XTTS_SERVICE_DIR.exists())
    return {
        'engine': 'xtts',
        'available': available,
        'voices': voices,
        'accentGroups': groups,
        'groups': groups,
        'count': len(voices),
        'message': message,
    }


def xtts_is_available() -> bool:
    # Remote server configured: treat as available (borrow-from-region works without local voice cache)
    if XTTS_SERVER_URL:
        return True
    # Local CLI present: consider engine available even if voices dir is empty,
    # since media replace can borrow a reference from the selected region.
    if not XTTS_PYTHON.exists() or not XTTS_PYTHON.is_file():
        return False
    if not XTTS_SERVICE_DIR.exists():
        return False
    return True


def _resolve_xtts_voice_path(identifier: str) -> Tuple[str, Path]:
    voice_map = get_xtts_voice_map()
    key = identifier.lower().strip()
    if key in voice_map:
        return key, voice_map[key]
    slug = _slugify_voice_id(identifier)
    if slug in voice_map:
        return slug, voice_map[slug]
    candidate = Path(identifier).expanduser()
    if candidate.exists():
        return _slugify_voice_id(candidate.stem), candidate
    raise PlaygroundError(f"Unknown XTTS voice '{identifier}'.", status=400)


def _xtts_prepare_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    base = validate_synthesis_payload(payload, require_voice=True)
    voice_identifier = str(base['voice'])
    voice_id, voice_path = _resolve_xtts_voice_path(voice_identifier)

    language = base['language'] or 'en'
    if '-' in language:
        language = language.split('-', 1)[0]

    try:
        speed = float(base['speed'])
    except (TypeError, ValueError):
        raise PlaygroundError('XTTS speed must be numeric.', status=400)

    format_value = str(payload.get('format', XTTS_OUTPUT_FORMAT) or 'wav').lower()
    if format_value not in {ext.lstrip('.') for ext in XTTS_SUPPORTED_EXTENSIONS}:
        raise PlaygroundError(f"Unsupported XTTS format '{format_value}'.", status=400)

    sample_rate_value = payload.get('sample_rate')
    try:
        sample_rate = int(sample_rate_value) if sample_rate_value is not None else 24000
    except (TypeError, ValueError):
        raise PlaygroundError('XTTS sample rate must be an integer.', status=400)

    temperature_value = payload.get('temperature', 0.6)
    try:
        temperature = float(temperature_value)
    except (TypeError, ValueError):
        raise PlaygroundError('XTTS temperature must be numeric.', status=400)

    seed_value = payload.get('seed', 42)
    try:
        seed = int(seed_value)
    except (TypeError, ValueError):
        raise PlaygroundError('XTTS seed must be an integer.', status=400)

    return {
        'text': base['text'],
        'voice_id': voice_id,
        'voice_path': voice_path,
        'language': language,
        'speed': speed,
        'temperature': temperature,
        'seed': seed,
        'format': format_value,
        'sample_rate': sample_rate,
    }


def _xtts_synthesise(data: Dict[str, Any]) -> Dict[str, Any]:
    if not xtts_is_available():
        raise PlaygroundError('XTTS engine is not available.', status=503)

    if XTTS_SERVER_URL:
        return _xtts_synthesise_via_server(data)

    format_ext = data['format'].lstrip('.')
    filename = f"{int(time.time())}-{uuid.uuid4().hex[:10]}-xtts.{format_ext}"
    output_path = OUTPUT_DIR / filename

    cmd = [
        str(XTTS_PYTHON),
        '-m',
        'tts_service.cli',
        '--text',
        data['text'],
        '--speaker-ref',
        str(data['voice_path']),
        '--out',
        str(output_path),
        '--language',
        data['language'],
        '--speed',
        f"{data['speed']}",
        '--format',
        format_ext,
        '--sample-rate',
        str(data['sample_rate']),
        '--seed',
        str(data['seed']),
        '--temperature',
        f"{data['temperature']}",
        '--no-cache',
    ]

    env = os.environ.copy()
    env.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')
    env.setdefault('PYTORCH_MPS_HIGH_WATERMARK_RATIO', '0.0')
    env.setdefault('CUDA_VISIBLE_DEVICES', '-1')

    try:
        result = subprocess.run(
            cmd,
            cwd=XTTS_SERVICE_DIR,
            capture_output=True,
            text=True,
            timeout=XTTS_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as exc:
        raise PlaygroundError('XTTS python executable not found. Set XTTS_PYTHON to the CLI interpreter.', status=500) from exc
    except subprocess.TimeoutExpired as exc:
        raise PlaygroundError('XTTS synthesis timed out.', status=504) from exc

    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or 'Unknown error'
        raise PlaygroundError(f"XTTS synthesis failed: {message}", status=500)

    if not output_path.exists():
        raise PlaygroundError('XTTS did not produce an output file.', status=500)

    return {
        'id': filename,
        'engine': 'xtts',
        'voice': data['voice_id'],
        'path': f"/audio/{filename}",
        'filename': filename,
        'sample_rate': data['sample_rate'],
    }


def _xtts_synthesise_via_server(data: Dict[str, Any]) -> Dict[str, Any]:
    if not XTTS_SERVER_URL:
        raise PlaygroundError('XTTS server URL is not configured.', status=500)

    import requests
    from urllib.parse import urljoin

    base_url = XTTS_SERVER_URL.rstrip('/')
    payload = {
        "text": data["text"],
        "speaker_ref": str(data["voice_path"]),
        "language": data["language"],
        "temperature": data["temperature"],
        "speed": data["speed"],
        "seed": data["seed"],
        "format": data["format"].lstrip('.'),
        "sample_rate": data["sample_rate"],
    }

    try:
        response = requests.post(
            f"{base_url}/tts",
            json=payload,
            timeout=XTTS_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise PlaygroundError(f"XTTS server request failed: {exc}", status=503) from exc

    if response.status_code != 200:
        message = response.text.strip() or f"HTTP {response.status_code}"
        raise PlaygroundError(f"XTTS server error: {message}", status=response.status_code)

    try:
        result = response.json()
    except ValueError as exc:
        raise PlaygroundError("XTTS server returned invalid JSON.", status=500) from exc

    if not result.get("success"):
        error_message = result.get("error") or result.get("message") or "Unknown XTTS server failure."
        raise PlaygroundError(f"XTTS server failed: {error_message}", status=500)

    audio_path = result.get("audio_url")
    if not audio_path:
        raise PlaygroundError("XTTS server response missing audio URL.", status=500)

    download_url = urljoin(f"{base_url}/", audio_path.lstrip('/'))
    try:
        download_response = requests.get(download_url, timeout=XTTS_TIMEOUT_SECONDS)
        download_response.raise_for_status()
    except requests.RequestException as exc:
        raise PlaygroundError(f"Failed to download XTTS audio: {exc}", status=500) from exc

    format_ext = data['format'].lstrip('.')
    filename = f"{int(time.time())}-{uuid.uuid4().hex[:10]}-xtts.{format_ext}"
    output_path = OUTPUT_DIR / filename
    try:
        output_path.write_bytes(download_response.content)
    except OSError as exc:
        raise PlaygroundError(f"Failed to write XTTS output: {exc}", status=500) from exc

    return {
        'id': filename,
        'engine': 'xtts',
        'voice': data['voice_id'],
        'path': f"/audio/{filename}",
        'filename': filename,
        'sample_rate': data['sample_rate'],
    }



def _normalise_openvoice_language(value: Optional[str]) -> str:
    return "English"


def load_openvoice_styles() -> Dict[str, List[str]]:
    global _openvoice_style_cache
    with _openvoice_style_lock:
        if _openvoice_style_cache is not None:
            return dict(_openvoice_style_cache)
        mapping: Dict[str, List[str]] = {}
        config_path = OPENVOICE_CKPT_ROOT / "base_speakers" / "EN" / "config.json"
        if config_path.exists():
            try:
                with config_path.open("r", encoding="utf-8") as config_file:
                    config_data = json.load(config_file)
                speaker_map = config_data.get("speakers", {})
                styles = sorted(str(name) for name in speaker_map.keys())
                if styles:
                    mapping["English"] = styles
            except (OSError, json.JSONDecodeError):
                pass
        _openvoice_style_cache = mapping
        return dict(mapping)


def get_openvoice_voice_map() -> Dict[str, Dict[str, Any]]:
    reference_root = OPENVOICE_REFERENCE_DIR
    mapping: Dict[str, Dict[str, Any]] = {}
    if reference_root.exists():
        for path in sorted(reference_root.rglob("*")):
            if not path.is_file():
                continue
            if path.suffix.lower() not in OPENVOICE_SUPPORTED_EXTENSIONS:
                continue
            language = "English"
            base_id = f"openvoice_{_slugify_voice_id(path.stem)}"
            voice_id = base_id
            counter = 1
            while voice_id in mapping:
                counter += 1
                voice_id = f"{base_id}_{counter}"
            try:
                relative_path = path.resolve().relative_to(reference_root.resolve())
            except ValueError:
                continue
            mapping[voice_id] = {
                "path": path.resolve(),
                "relative_path": relative_path,
                "language": language,
                "style": "default",
                "label": path.stem.replace('_', ' ').title(),
            }
    with _openvoice_voice_lock:
        _openvoice_voice_cache.clear()
        _openvoice_voice_cache.update(mapping)
    return dict(mapping)


def build_openvoice_voice_payload() -> Dict[str, Any]:
    styles_map = load_openvoice_styles()
    voice_map = get_openvoice_voice_map()
    accent_map = {
        "English": ("openvoice_en", "OpenVoice English", "🇺🇸"),
    }
    voices: List[Dict[str, Any]] = []
    grouped: Dict[str, List[str]] = {}
    for voice_id, meta in voice_map.items():
        language = meta.get("language", "English")
        accent = accent_map.get(language, accent_map["English"])
        preview_url = _find_cached_preview("openvoice", voice_id)
        voices.append(
            {
                "id": voice_id,
                "label": meta.get("label", voice_id.title()),
                "locale": None,
                "gender": None,
                "tags": ["OpenVoice", language],
                "notes": meta["path"].name,
                "accent": {"id": accent[0], "label": accent[1], "flag": accent[2]},
                "raw": {
                    "engine": "openvoice",
                    "reference": str(meta["path"]),
                    "reference_relative": str(meta["relative_path"]),
                    "language": language,
                    "style": meta.get("style", "default"),
                },
            }
        )
        if preview_url:
            voices[-1]["raw"]["preview_url"] = preview_url
        grouped.setdefault(language, []).append(voice_id)
    accent_groups: List[Dict[str, Any]] = []
    for language, members in grouped.items():
        accent = accent_map.get(language, accent_map["English"])
        accent_groups.append(
            {
                "id": f"openvoice_{language.lower()}",
                "label": f"OpenVoice {language}",
                "flag": accent[2],
                "voices": members,
                "count": len(members),
            }
        )
    message = None
    if not voices:
        message = "Add reference clips under openvoice/resources/ and reload."
    python_path = _get_openvoice_python()
    base_dir = OPENVOICE_CKPT_ROOT / "base_speakers" / "EN"
    converter_dir = OPENVOICE_CKPT_ROOT / "converter"
    available = python_path.exists() and base_dir.exists() and converter_dir.exists() and bool(voices)
    styles = styles_map.get("English", [])
    styles_with_default = sorted({"default", *styles})
    return {
        "engine": "openvoice",
        "available": available,
        "voices": voices,
        "accentGroups": accent_groups,
        "groups": accent_groups,
        "count": len(voices),
        "styles": styles_with_default,
        "message": message,
    }


def openvoice_is_available() -> bool:
    python_path = _get_openvoice_python()
    if not python_path.exists():
        return False
    if not OPENVOICE_CKPT_ROOT.exists():
        return False
    converter_dir = OPENVOICE_CKPT_ROOT / "converter"
    base_dir = OPENVOICE_CKPT_ROOT / "base_speakers" / "EN"
    if not converter_dir.exists() or not base_dir.exists():
        return False
    voice_map = get_openvoice_voice_map()
    return bool(voice_map)


def _get_openvoice_python() -> Path:
    if OPENVOICE_PYTHON.exists() and OPENVOICE_PYTHON.is_file():
        return OPENVOICE_PYTHON
    return Path(sys.executable).resolve()


def _openvoice_prepare_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    base = validate_synthesis_payload(payload, require_voice=True)
    voice_map = get_openvoice_voice_map()
    voice_identifier = str(base["voice"])
    meta = voice_map.get(voice_identifier)
    if meta is None:
        raise PlaygroundError(f"Unknown OpenVoice reference '{voice_identifier}'.", status=400)

    language = _normalise_openvoice_language(payload.get("language") or meta.get("language"))
    styles_map = load_openvoice_styles()
    available_styles_raw = styles_map.get(language, [])
    available_styles = sorted({"default", *available_styles_raw})
    requested_style = str(payload.get("style") or meta.get("style") or (available_styles[0] if available_styles else "default"))
    if requested_style not in available_styles:
        raise PlaygroundError(
            f"Style '{requested_style}' is not available for OpenVoice {language}.",
            status=400,
        )

    watermark = str(payload.get("watermark") or OPENVOICE_WATERMARK)
    return {
        "text": base["text"],
        "voice_id": voice_identifier,
        "reference_path": meta["path"],
        "reference_relative": meta.get("relative_path"),
        "language": language,
        "style": requested_style,
        "watermark": watermark,
        "sample_rate": 22050,
    }


def _openvoice_synthesise(data: Dict[str, Any]) -> Dict[str, Any]:
    if not openvoice_is_available():
        raise PlaygroundError("OpenVoice engine is not available.", status=503)

    filename = f"{int(time.time())}-{uuid.uuid4().hex[:10]}-openvoice.wav"
    output_path = OUTPUT_DIR / filename
    python_path = _get_openvoice_python()

    cmd = [
        str(python_path),
        "scripts/cli_demo.py",
        "--text",
        data["text"],
        "--language",
        data["language"],
        "--style",
        data["style"],
        "--reference",
        str(data["reference_path"]),
        "--output",
        str(output_path),
        "--ckpt-root",
        str(OPENVOICE_CKPT_ROOT),
        "--device",
        "cpu",
        "--watermark-message",
        data["watermark"],
    ]

    env = os.environ.copy()
    env.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    env.setdefault("PYTORCH_MPS_HIGH_WATERMARK_RATIO", "0.0")
    env.setdefault("CUDA_VISIBLE_DEVICES", "-1")

    try:
        result = subprocess.run(
            cmd,
            cwd=OPENVOICE_ROOT,
            capture_output=True,
            text=True,
            timeout=OPENVOICE_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as exc:
        raise PlaygroundError(
            "OpenVoice python executable not found. Set OPENVOICE_PYTHON to the CLI interpreter.",
            status=500,
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise PlaygroundError("OpenVoice synthesis timed out.", status=504) from exc

    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or "Unknown error"
        raise PlaygroundError(f"OpenVoice synthesis failed: {message}", status=500)

    if not output_path.exists():
        raise PlaygroundError("OpenVoice did not produce an output file.", status=500)

    base_artifact = output_path.with_name(f"{output_path.stem}_base.wav")
    if base_artifact.exists():
        try:
            base_artifact.unlink()
        except OSError:
            pass

    reference_relative: Optional[str] = None
    try:
        reference_relative = str(Path(data["reference_path"]).resolve().relative_to(OPENVOICE_REFERENCE_DIR.resolve()))
    except ValueError:
        reference_relative = None

    return {
        "id": filename,
        "engine": "openvoice",
        "voice": data["voice_id"],
        "path": f"/audio/{filename}",
        "filename": filename,
        "sample_rate": data["sample_rate"],
        "language": data["language"],
        "style": data["style"],
        "reference": str(data["reference_path"]),
        "reference_name": Path(data["reference_path"]).name,
        "reference_relative": reference_relative,
        "watermark": data["watermark"],
    }



def build_chattts_voice_payload() -> Dict[str, Any]:
    available = chattts_is_available()
    presets = chattts_list_presets()
    voices: List[Dict[str, Any]] = []
    groups: List[Dict[str, Any]] = []

    voice_map: Dict[str, Dict[str, Any]] = {}

    if available:
        random_voice_id = 'chattts_random'
        preview_url = _find_cached_preview("chattts", random_voice_id)
        raw_random: Dict[str, Any] = {'engine': 'chattts', 'type': 'random'}
        if preview_url:
            raw_random['preview_url'] = preview_url
        voices.append(
            {
                'id': random_voice_id,
                'label': 'Random Speaker',
                'locale': None,
                'gender': None,
                'tags': ['ChatTTS'],
                'notes': 'Sampled from ChatTTS model at runtime.',
                'accent': {'id': 'chattts', 'label': 'ChatTTS', 'flag': '🎤'},
                'raw': raw_random,
            }
        )
        voice_map[random_voice_id] = {'type': 'random'}

    preset_voice_ids: List[str] = []
    for preset in presets:
        preset_id = preset.get('id')
        speaker = preset.get('speaker')
        if not isinstance(preset_id, str) or not preset_id.strip() or not isinstance(speaker, str):
            continue
        normalised_speaker = _normalise_chattts_speaker(speaker)
        if not normalised_speaker:
            continue
        preset_voice_id = f"chattts_preset_{preset_id}"
        preview_url = _find_cached_preview("chattts", preset_voice_id)
        raw_preset: Dict[str, Any] = {
            'engine': 'chattts',
            'type': 'preset',
            'preset_id': preset_id,
            'speaker': normalised_speaker,
            'seed': preset.get('seed'),
        }
        if preview_url:
            raw_preset['preview_url'] = preview_url
        voices.append(
            {
                'id': preset_voice_id,
                'label': preset.get('label') or preset_id,
                'locale': None,
                'gender': None,
                'tags': ['ChatTTS', 'Preset'],
                'notes': preset.get('notes'),
                'accent': {'id': 'chattts_preset', 'label': 'ChatTTS Preset', 'flag': '🎙️'},
                'raw': raw_preset,
            }
        )
        voice_map[preset_voice_id] = {
            'type': 'preset',
            'preset_id': preset_id,
            'speaker': normalised_speaker,
            'seed': preset.get('seed'),
        }
        preset_voice_ids.append(preset_voice_id)

    if voices:
        groups.append(
            {
                'id': 'chattts_all',
                'label': 'ChatTTS Voices',
                'flag': '🎤',
                'voices': [voice['id'] for voice in voices],
                'count': len(voices),
            }
        )
        if preset_voice_ids:
            groups.append(
                {
                    'id': 'chattts_presets',
                    'label': 'Saved Presets',
                    'flag': '⭐️',
                    'voices': preset_voice_ids,
                    'count': len(preset_voice_ids),
                }
            )

    with _chattts_voice_lock:
        _chattts_voice_cache.clear()
        _chattts_voice_cache.update(voice_map)

    return {
        'engine': 'chattts',
        'available': available,
        'voices': voices,
        'accentGroups': groups,
        'groups': groups,
        'count': len(voices),
        'presets': presets,
        'message': None if available else 'Install ChatTTS weights and ensure .venv exists to enable synthesis.',
    }


def chattts_is_available() -> bool:
    if not CHATTT_ROOT.exists():
        return False
    if not CHATTT_PYTHON.exists():
        return False
    cli_script = CHATTT_ROOT / 'examples' / 'cmd' / 'run.py'
    if not cli_script.exists():
        return False
    asset_dir = CHATTT_ROOT / 'asset'
    if not asset_dir.exists():
        return False
    return True


def chattts_list_presets() -> List[Dict[str, Any]]:
    directory = CHATTT_PRESET_DIR
    if not directory.exists() or not directory.is_dir():
        return []

    presets: List[Dict[str, Any]] = []
    seen_ids: Set[str] = set()

    files = sorted(directory.glob("*"))
    for index, path in enumerate(files, start=1):
        if not path.is_file():
            continue

        preset_id: Optional[str] = None
        label: Optional[str] = None
        notes: Optional[str] = None
        speaker: Optional[str] = None
        seed_value: Optional[int] = None

        if path.suffix.lower() == ".json":
            try:
                with path.open("r", encoding="utf-8") as preset_file:
                    data = json.load(preset_file)
            except (OSError, json.JSONDecodeError):
                continue
            speaker_value = data.get("speaker")
            if isinstance(speaker_value, str):
                speaker = speaker_value.strip()
            if not speaker:
                continue
            raw_id = data.get("id")
            if isinstance(raw_id, str) and raw_id.strip():
                preset_id = raw_id.strip()
            raw_label = data.get("label")
            if isinstance(raw_label, str) and raw_label.strip():
                label = raw_label.strip()
            raw_notes = data.get("notes")
            if isinstance(raw_notes, str) and raw_notes.strip():
                notes = raw_notes.strip()
            raw_seed = data.get("seed")
            if isinstance(raw_seed, (int, float, str)):
                try:
                    seed_candidate = int(str(raw_seed).strip())
                except (TypeError, ValueError):
                    seed_candidate = None
                if seed_candidate is not None:
                    seed_value = seed_candidate
        elif path.suffix.lower() == ".txt":
            try:
                speaker_value = path.read_text(encoding="utf-8")
            except OSError:
                continue
            speaker = speaker_value.strip()
            if not speaker:
                continue
            label = path.stem.replace("_", " ").title() or None
        else:
            continue

        if speaker is None:
            continue

        if preset_id is None:
            preset_id = path.stem.strip() or f"preset-{index}"
        if label is None:
            label = preset_id

        if preset_id in seen_ids:
            continue
        seen_ids.add(preset_id)

        entry = {
            "id": preset_id,
            "label": label,
            "speaker": speaker,
        }
        if notes is not None:
            entry["notes"] = notes
        if seed_value is not None:
            entry["seed"] = seed_value
        presets.append(entry)

    return presets


def _extract_chattts_speaker(stdout: str) -> Optional[str]:
    capture_next = False
    for raw_line in stdout.splitlines():
        if capture_next:
            candidate = raw_line.strip()
            if candidate:
                return candidate
            continue
        if "Use speaker" in raw_line:
            capture_next = True
    return None


def _slugify_chattts_preset_id(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return slug


def _get_chattts_python() -> Path:
    if CHATTT_PYTHON.exists() and CHATTT_PYTHON.is_file():
        return CHATTT_PYTHON
    return Path(sys.executable).resolve()


def _chattts_prepare_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    base = validate_synthesis_payload(payload, require_voice=False)
    voice_identifier = str(base.get('voice') or payload.get('voice') or 'chattts_random').strip() or 'chattts_random'

    with _chattts_voice_lock:
        meta = _chattts_voice_cache.get(voice_identifier)

    speaker_value: Optional[str] = None
    preset_seed: Optional[int] = None
    if meta:
        if isinstance(meta.get('speaker'), str) and meta['speaker'].strip():
            speaker_value = meta['speaker'].strip()
        if meta.get('seed') is not None:
            try:
                preset_seed = int(meta['seed'])
            except (TypeError, ValueError):
                preset_seed = None

    explicit_speaker = payload.get('speaker')
    if isinstance(explicit_speaker, str) and explicit_speaker.strip():
        speaker_value = explicit_speaker.strip()

    text = base['text']
    seed: Optional[int] = None
    raw_seed = payload.get('seed')
    if raw_seed is not None and raw_seed != "":
        try:
            seed_candidate = int(str(raw_seed).strip())
        except (TypeError, ValueError) as exc:
            raise PlaygroundError('ChatTTS seed must be an integer.', status=400) from exc
        seed = seed_candidate
    if seed is None and preset_seed is not None:
        seed = preset_seed
    if seed is None:
        seed = random.randint(0, 2**31 - 1)

    speaker_value = _normalise_chattts_speaker(speaker_value)

    return {
        'text': text,
        'voice_id': voice_identifier,
        'speaker': speaker_value,
        'format': 'mp3',
        'seed': seed,
    }


def _chattts_synthesise(data: Dict[str, Any]) -> Dict[str, Any]:
    if not chattts_is_available():
        raise PlaygroundError('ChatTTS engine is not available.', status=503)

    python_path = _get_chattts_python()
    filename = f"{int(time.time())}-{uuid.uuid4().hex[:10]}-chattts.mp3"
    output_path = OUTPUT_DIR / filename

    before_files = {path.name for path in CHATTT_ROOT.glob('output_audio_*.mp3')}

    cmd = [
        str(python_path),
        'examples/cmd/run.py',
    ]
    speaker = data.get('speaker')
    if speaker:
        cmd.extend(['--spk', speaker])
    seed_value = data.get('seed')
    if seed_value is not None:
        cmd.extend(['--seed', str(seed_value)])
    source = CHATTT_SOURCE or 'local'
    if source:
        cmd.extend(['--source', source])
    cmd.append(data['text'])

    env = os.environ.copy()
    env.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')
    env.setdefault('PYTORCH_MPS_HIGH_WATERMARK_RATIO', '0.0')
    env.setdefault('CUDA_VISIBLE_DEVICES', '-1')

    try:
        result = subprocess.run(
            cmd,
            cwd=CHATTT_ROOT,
            capture_output=True,
            text=True,
            timeout=CHATTT_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as exc:
        raise PlaygroundError('ChatTTS python executable not found. Set CHATTT_PYTHON to the CLI interpreter.', status=500) from exc
    except subprocess.TimeoutExpired as exc:
        raise PlaygroundError('ChatTTS synthesis timed out.', status=504) from exc

    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or 'Unknown error'
        raise PlaygroundError(f'ChatTTS synthesis failed: {message}', status=500)

    captured_speaker: Optional[str] = None
    if isinstance(speaker, str) and speaker.strip():
        captured_speaker = speaker.strip()
    extracted_speaker = _extract_chattts_speaker(result.stdout)
    if extracted_speaker:
        captured_speaker = extracted_speaker
    else:
        match = re.search(r"SPEAKER(?:-|:)?\s*-?\s*(.+)", result.stderr, re.IGNORECASE)
        if match:
            captured_speaker = match.group(1).strip()
        elif result.stdout.strip():
            captured_speaker = result.stdout.strip()

    generated_files = [
        candidate
        for candidate in CHATTT_ROOT.glob('output_audio_*.mp3')
        if candidate.name not in before_files
    ]
    if not generated_files:
        generated_files = sorted(CHATTT_ROOT.glob('output_audio_*.mp3'), key=lambda candidate: candidate.stat().st_mtime, reverse=True)
    if not generated_files:
        raise PlaygroundError('ChatTTS did not produce an output file.', status=500)

    source_file = generated_files[0]
    try:
        shutil.move(str(source_file), str(output_path))
    except OSError as exc:
        raise PlaygroundError(f'Failed to move ChatTTS output: {exc}', status=500) from exc

    return {
        'id': filename,
        'engine': 'chattts',
        'voice': data['voice_id'],
        'path': f"/audio/{filename}",
        'filename': filename,
        'sample_rate': 24000,
        'seed': seed_value,
        'speaker': captured_speaker,
    }




# ---------------------------------------------------------------------------
# Random text helpers
# ---------------------------------------------------------------------------


def build_random_snippets() -> Dict[str, List[str]]:
    return {
        "any": [
            "Welcome to the Kokoro Playground. Generate speech clips, audition voices, and tweak the pacing to fit your project.",
            "Testing, one two three. This is a friendly reminder that synthetic voices can be astonishingly crisp when tuned properly.",
        ],
        "narration": [
            "In the stillness between the trees, a quiet melody carried the promise of the coming dawn.",
            "The crew had rehearsed for months, but nothing prepared them for the thrill of opening night.",
        ],
        "promo": [
            "Upgrade your workflow with Kokoro Playground Pro. Faster rendering, smarter presets, limitless creativity.",
            "Your story deserves a captivating voice. Launch the playground and discover the perfect tone in seconds.",
        ],
        "dialogue": [
            "I can't believe it worked. All those late nights finally paid off.",
            "You really think this voice will convince them? Trust me, it's the right choice.",
        ],
        "news": [
            "Local engineers today unveiled a breakthrough text-to-speech model designed for studio quality voiceovers.",
            "In technology headlines, developers are embracing on-device speech synthesis for privacy-conscious products.",
        ],
        "story": [
            "Beneath the shifting aurora, the explorers found a hidden city pulsing with ancient light.",
            "Every legend begins with a single voice daring to speak the impossible aloud.",
        ],
        "whimsy": [
            "Some voices sparkle like stardust; others hum like a cup of tea on a rainy afternoon.",
            "This sentence serves no purpose except to make the waveform wiggle in a delightful way.",
        ],
    }


RANDOM_SNIPPETS = build_random_snippets()
RANDOM_CATEGORIES = sorted(RANDOM_SNIPPETS.keys())

ACCENT_PREFIX_MAP: Dict[str, Tuple[str, str, str]] = {
    "af": ("us_female", "USA · Female", "🇺🇸"),
    "am": ("us_male", "USA · Male", "🇺🇸"),
    "bf": ("uk_female", "UK · Female", "🇬🇧"),
    "bm": ("uk_male", "UK · Male", "🇬🇧"),
}

ACCENT_LOCALE_MAP: Dict[str, Tuple[str, str, str]] = {
    "en-us": ("us", "USA", "🇺🇸"),
    "en-gb": ("uk", "UK", "🇬🇧"),
    "en-au": ("au", "Australian English", "🇦🇺"),
    "en-ca": ("ca", "Canadian English", "🇨🇦"),
    "en-in": ("in", "Indian English", "🇮🇳"),
    "en-nz": ("nz", "New Zealand English", "🇳🇿"),
    "en-za": ("za", "South African English", "🇿🇦"),
    "fr-fr": ("fr", "French", "🇫🇷"),
    "de-de": ("de", "German", "🇩🇪"),
    "es-es": ("es", "Spanish", "🇪🇸"),
    "ja-jp": ("ja", "Japanese", "🇯🇵"),
    "ko-kr": ("ko", "Korean", "🇰🇷"),
}

DEFAULT_ACCENT: Tuple[str, str, str] = ("other", "Other", "🌐")


def call_ollama(category: Optional[str], temperature: float = 0.7) -> Optional[str]:
    import requests

    ollama_url = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
    model = os.environ.get("OLLAMA_MODEL", "phi3:latest")
    prompt_parts = [
        "Compose a short paragraph suitable for testing a text-to-speech voice.",
        "Keep it under 60 words.",
    ]
    if category and category != "any":
        prompt_parts.append(f"The tone should feel like: {category}.")
    prompt = " ".join(prompt_parts)

    try:
        response = requests.post(
            f"{ollama_url.rstrip('/')}/api/generate",
            json={
                "model": model,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": temperature, "top_p": 0.9},
            },
            timeout=20,
        )
        response.raise_for_status()
        data = response.json()
        text = data.get("response")
        if isinstance(text, str) and text.strip():
            return text.strip()
    except requests.RequestException:
        return None
    return None


def list_ollama_models() -> Dict[str, Any]:
    import requests

    ollama_url = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
    try:
        response = requests.get(f"{ollama_url}/api/tags", timeout=10)
        response.raise_for_status()
        payload = response.json()
        models: List[str] = []
        if isinstance(payload, dict):
            if isinstance(payload.get("models"), list):
                models = [
                    item.get("name")
                    for item in payload["models"]
                    if isinstance(item, dict) and isinstance(item.get("name"), str)
                ]
            elif isinstance(payload.get("data"), list):
                models = [
                    item.get("name")
                    for item in payload["data"]
                    if isinstance(item, dict) and isinstance(item.get("name"), str)
                ]
        return {"models": models, "source": "ollama", "url": ollama_url}
    except requests.RequestException as exc:
        return {"models": [], "source": "offline", "url": ollama_url, "error": str(exc)}


## Ollama proxy endpoints defined after blueprint (see below)


# ---------------------------------------------------------------------------
# Audio helpers
# ---------------------------------------------------------------------------


def synthesise_audio_clip(
    text: str,
    voice: str,
    speed: float,
    language: str,
    trim_silence: bool,
) -> Dict[str, Any]:
    tts = get_tts()
    audio, sample_rate = tts.create(text, voice=voice, speed=speed, lang=language, trim=trim_silence)
    audio = np.squeeze(audio).astype(np.float32)

    filename = f"{int(time.time())}-{uuid.uuid4().hex[:10]}-{voice}.wav"
    output_path = OUTPUT_DIR / filename
    sf.write(output_path, audio, sample_rate)

    voice_profile = next((profile for profile in load_voice_profiles() if profile.id == voice), None)
    accent_payload: Optional[Dict[str, Any]] = None
    if voice_profile is not None:
        accent_payload = {
            "id": voice_profile.accent_id,
            "label": voice_profile.accent_label,
            "flag": voice_profile.accent_flag,
        }

    return {
        "id": filename,
        "engine": "kokoro",
        "voice": voice,
        "sample_rate": sample_rate,
        "path": f"/audio/{filename}",
        "filename": filename,
        "locale": voice_profile.locale if voice_profile else None,
        "accent": accent_payload,
        "language": language,
        "speed": speed,
        "trim_silence": trim_silence,
        "text": text,
    }


def concatenate_clips(clips: Iterable[np.ndarray], sample_rate: int, gap_seconds: float = 1.0) -> np.ndarray:
    gap_length = max(int(sample_rate * gap_seconds), 0)
    gap = np.zeros(gap_length, dtype=np.float32) if gap_length else np.zeros(0, dtype=np.float32)

    segments: List[np.ndarray] = []
    for clip in clips:
        segments.append(clip.astype(np.float32))
        segments.append(gap)
    if segments:
        segments.pop()
    if not segments:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(segments)


def _load_wav_mono(path: Path, target_sr: Optional[int] = None) -> Tuple[np.ndarray, int]:
    import soundfile as _sf
    import numpy as _np
    import librosa as _lb
    audio, sr = _sf.read(str(path), dtype='float32', always_2d=False)
    if audio.ndim > 1:
        audio = _np.mean(audio, axis=1).astype('float32')
    if target_sr and sr != target_sr:
        audio = _lb.resample(audio, orig_sr=sr, target_sr=target_sr)
        sr = target_sr
    return audio.astype('float32'), sr


def _time_stretch_to_len(samples: np.ndarray, sr: int, target_len: int) -> np.ndarray:
    """High-quality time stretch using ffmpeg atempo chain, fallback to librosa.

    Keeps pitch. Builds a chain of atempo steps within [0.5, 2.0] to reach the desired ratio.
    """
    import tempfile as _tf
    import soundfile as _sf
    cur = len(samples)
    if cur <= 1 or target_len <= 1:
        return np.zeros(target_len, dtype='float32')
    ratio = cur / float(target_len)  # playback rate needed
    try:
        # Decompose into steps in [0.5, 2.0]
        steps: list[float] = []
        r = ratio
        while r > 2.0:
            steps.append(2.0)
            r /= 2.0
        while r < 0.5:
            steps.append(0.5)
            r /= 0.5
        steps.append(r)
        filt = ",".join([f"atempo={s:.6f}" for s in steps])
        with _tf.TemporaryDirectory(prefix="ffts-") as td:
            inp = Path(td) / "in.wav"
            outp = Path(td) / "out.wav"
            _sf.write(inp, samples.astype('float32'), sr)
            cmd = ["ffmpeg","-hide_banner","-nostdin","-loglevel","error","-y","-i", str(inp), "-filter:a", filt, "-ar", str(sr), str(outp)]
            subprocess.run(cmd, check=True)
            stretched, _ = _sf.read(outp, dtype='float32', always_2d=False)
        stretched = stretched.astype('float32')
    except Exception:
        # Fallback: librosa
        import librosa as _lb
        rate = float(max(0.5, min(2.5, ratio)))
        stretched = _lb.effects.time_stretch(samples, rate=rate).astype('float32')
    # Adjust to exactly target_len
    if len(stretched) > target_len:
        stretched = stretched[:target_len]
    elif len(stretched) < target_len:
        pad = target_len - len(stretched)
        stretched = np.pad(stretched, (0, pad), mode='constant')
    return stretched


def _rms(x: np.ndarray) -> float:
    x = x.astype('float32')
    return float(np.sqrt(np.mean(np.square(x) + 1e-9)))


def _apply_replace_with_crossfade(
    source: np.ndarray,
    rep: np.ndarray,
    sr: int,
    i0: int,
    i1: int,
    fade_ms: float = 30.0,
    duck_gain: Optional[float] = None,
) -> np.ndarray:
    out = source.copy()
    target_len = max(i1 - i0, 1)
    if len(rep) != target_len:
        rep = _time_stretch_to_len(rep, sr, target_len)
    # Loudness match using 0.5s neighborhood
    pre0 = max(0, i0 - int(0.5 * sr))
    pre = source[pre0:i0]
    post1 = min(len(source), i1 + int(0.5 * sr))
    post = source[i1:post1]
    ref = np.concatenate([pre, post]) if len(pre) + len(post) > 0 else None
    if ref is not None and len(ref) > 0:
        r_ref = _rms(ref)
        r_rep = _rms(rep)
        if r_rep > 0:
            rep = rep * (r_ref / r_rep)
    # Crossfade with optional ducking of the original within the region
    fade = int(min(int(fade_ms / 1000.0 * sr), target_len // 4))
    fade = max(fade, 1)
    # Start crossfade
    for t in range(fade):
        a = (t + 1) / float(fade)
        if duck_gain and duck_gain > 0:
            # Transition from source to (rep + ducked source)
            out[i0 + t] = (source[i0 + t] * ((1.0 - a) + a * duck_gain)) + (rep[t] * a)
        else:
            out[i0 + t] = source[i0 + t] * (1.0 - a) + rep[t] * a
    # Middle
    if target_len > 2 * fade:
        if duck_gain and duck_gain > 0:
            out[i0 + fade : i1 - fade] = rep[fade : target_len - fade] + (source[i0 + fade : i1 - fade] * duck_gain)
        else:
            out[i0 + fade : i1 - fade] = rep[fade : target_len - fade]
    # End crossfade
    for t in range(fade):
        a = (t + 1) / float(fade)
        if duck_gain and duck_gain > 0:
            # Transition from (rep + ducked source) back to source
            s = source[i1 - fade + t]
            r = rep[target_len - fade + t]
            out[i1 - fade + t] = (r * (1.0 - a)) + s * (duck_gain * (1.0 - a) + a)
        else:
            out[i1 - fade + t] = rep[target_len - fade + t] * (1.0 - a) + source[i1 - fade + t] * a

    # Soft limiter to prevent clipping while preserving loudness
    def _soft_limit(x: np.ndarray, ceiling: float = 0.98, drive: float = 2.0) -> np.ndarray:
        if x.size == 0:
            return x
        peak = float(np.max(np.abs(x)))
        if peak <= ceiling:
            return x
        # Apply tanh-based soft saturation normalized to the ceiling
        y = np.tanh((x / ceiling) * drive) / np.tanh(drive)
        return (y * ceiling).astype('float32')

    out = _soft_limit(out)
    # Final safety in extreme cases
    try:
        peak2 = float(np.max(np.abs(out)))
        if peak2 > 1.0:
            out = (out / peak2) * 0.98
    except Exception:
        pass
    return out


def _trim_silence(samples: np.ndarray, *, top_db: float = 40.0, sr: int = 24000, prepad_ms: float = 10.0, postpad_ms: float = 10.0) -> np.ndarray:
    """Energy-based trimming for leading/trailing silence.

    Uses librosa.effects.trim; adds small pre/post padding to avoid hard cuts.
    """
    import librosa as _lb
    if samples.size == 0:
        return samples
    try:
        trimmed, idx = _lb.effects.trim(samples, top_db=top_db)
        if idx is not None and len(idx) == 2:
            start = max(0, idx[0] - int(prepad_ms / 1000.0 * sr))
            end = min(len(samples), idx[1] + int(postpad_ms / 1000.0 * sr))
            return samples[start:end].astype('float32')
    except Exception:
        pass
    return samples.astype('float32')


# ---------------------------------------------------------------------------
# Flask app & routes
# ---------------------------------------------------------------------------

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
api = Blueprint("api", __name__)
_favorites_store = FavoritesStore(FAVORITES_STORE_PATH)

def _check_api_key() -> None:
    if not FAVORITES_API_KEY:
        return
    auth = request.headers.get("Authorization", "")
    token = auth.split(" ")[-1] if auth else ""
    if token != FAVORITES_API_KEY:
        raise PlaygroundError("Unauthorized", status=401)


@app.errorhandler(PlaygroundError)
def handle_playground_error(err: PlaygroundError):
    payload = {"error": str(err), "status": err.status}
    return make_response(jsonify(payload), err.status)


@app.errorhandler(Exception)
def handle_generic_error(err: Exception):  # pragma: no cover
    payload = {"error": str(err), "status": 500}
    return make_response(jsonify(payload), 500)


@api.route("/media/transcribe", methods=["POST"])
def media_transcribe_endpoint():
    """Transcribe an uploaded media file or a YouTube URL to word timings.

    Accepts either:
      - multipart/form-data with field: file
      - application/json: { source: 'youtube', url, start?, end? }
    """
    content_type = (request.content_type or "").lower()
    # Opportunistic cleanup of old media artifacts
    _maybe_cleanup_media_artifacts()
    job_id = uuid.uuid4().hex[:12]
    job_dir = _media_job_dir(job_id)
    input_path: Optional[Path] = None
    try:
        if content_type.startswith("multipart/form-data"):
            up = request.files.get("file")
            if not up or not up.filename:
                raise PlaygroundError("No file uploaded.", status=400)
            suffix = Path(up.filename).suffix or ".wav"
            input_path = job_dir / f"source{suffix}"
            up.save(str(input_path))
        else:
            payload = parse_json_request()
            source = str(payload.get("source") or "").strip().lower()
            if source != "youtube":
                raise PlaygroundError("Provide multipart 'file' upload or JSON { source: 'youtube', url }.", status=400)
            url = str(payload.get("url") or "").strip()
            if not url:
                raise PlaygroundError("Field 'url' is required for YouTube source.", status=400)
            # Simple cache for YouTube audio to avoid repeated downloads / 429s
            def _yt_id(u: str) -> Optional[str]:
                try:
                    m = re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{6,})", u)
                    return m.group(1) if m else None
                except Exception:
                    return None
            vid = _yt_id(url)
            cache_dir = OUTPUT_DIR / "media_cache" / "youtube"
            cache_path: Optional[Path] = None
            if vid:
                cache_dir.mkdir(parents=True, exist_ok=True)
                candidates = list(cache_dir.glob(f"{vid}.*"))
                if candidates:
                    cache_path = max(candidates, key=lambda p: p.stat().st_size)
                    _log(f"YouTube cache hit id={vid} path='{cache_path}'")
            if not _have_tool("yt-dlp") and not cache_path:
                raise PlaygroundError("yt-dlp is required for YouTube imports. Install 'yt-dlp' and try again.", status=503)
            if cache_path is None:
                temp_base = cache_dir / (vid or f"yt-{uuid.uuid4().hex}")
                out_tmpl = f"{temp_base}.%(ext)s"
                cmd = [
                    "yt-dlp",
                    "-f",
                    "bestaudio/best",
                    "--sleep-requests",
                    "1",
                    "--retry-sleep",
                    "2",
                    "--retries",
                    "3",
                    "-o",
                    out_tmpl,
                ]
                try:
                    if YT_DLP_COOKIES_PATH.exists():
                        cmd += ["--cookies", str(YT_DLP_COOKIES_PATH)]
                except Exception:
                    pass
                if YT_DLP_EXTRACTOR_ARGS.strip():
                    cmd += ["--extractor-args", YT_DLP_EXTRACTOR_ARGS.strip()]
                cmd.append(url)
                _log(f"yt-dlp download: url='{url}' out='{out_tmpl}'")
                subprocess.run(cmd, check=True)
                candidates = list(cache_dir.glob(f"{(vid or temp_base.name)}.*"))
                if not candidates:
                    raise PlaygroundError("yt-dlp did not produce an output file.", status=500)
                pref_order = [".m4a", ".mp3", ".webm", ".opus", ".ogg"]
                best = None
                for ext in pref_order:
                    for c in candidates:
                        if c.suffix.lower() == ext:
                            best = c
                            break
                    if best:
                        break
                cache_path = best or candidates[0]
                # Save metadata JSON alongside cache (best effort)
                try:
                    meta = _yt_dlp_info_json(url)
                    if vid:
                        _youtube_meta_save(vid, meta)
                except Exception:
                    pass
            input_path = cache_path

        if input_path is None:
            raise PlaygroundError("No input provided.", status=400)

        # Persist job meta about original input
        try:
            meta = {
                "input_path": str(input_path),
                "has_video": _ffprobe_has_video(input_path),
            }
            with open(job_dir / "job_meta.json", "w", encoding="utf-8") as f:
                json.dump(meta, f)
        except Exception:
            pass

        # Extract/normalise to wav for STT
        audio_wav = job_dir / "source.wav"
        _extract_input_to_wav(input_path, audio_wav)

        # STT
        try:
            transcript = _transcribe_faster_whisper(audio_wav)
        except PlaygroundError:
            if ALLOW_STUB_STT:
                transcript = _transcribe_stub(audio_wav)
            else:
                raise

        # Persist transcript alongside artifacts
        try:
            with open(job_dir / "transcript.json", "w", encoding="utf-8") as f:
                json.dump(transcript, f)
        except Exception:
            pass

        rel_audio = (audio_wav.relative_to(OUTPUT_DIR)).as_posix()
        # Record/log stats
        stats = transcript.get("stats") or {}
        try:
            _record_stat("transcribe", {
                "jobId": job_id,
                "duration": float(transcript.get("duration", 0) or 0),
                "elapsed": float(stats.get("elapsed", 0) or 0),
                "rtf": float(stats.get("rtf", 0) or 0),
                "language": transcript.get("language", "unknown"),
                "words": int(stats.get("words", len(transcript.get("words", []) or []))),
                "segments": int(stats.get("segments", len(transcript.get("segments", []) or []))),
                "ts": time.time(),
            })
        except Exception:
            pass
        _log(f"Transcribe done job={job_id} duration={transcript.get('duration', 0):.2f}s elapsed={stats.get('elapsed', 0):.2f}s rtf={stats.get('rtf', 0):.2f}x")
        return jsonify({
            "jobId": job_id,
            "media": {
                "audio_url": f"/audio/{rel_audio}",
                "duration": transcript.get("duration", 0),
            },
            "transcript": transcript,
            "whisperx": {"enabled": bool(WHISPERX_ENABLE and _have_whisperx)}
        })
    except PlaygroundError:
        raise
    except subprocess.CalledProcessError as exc:
        raise PlaygroundError(f"Media processing failed: {exc}", status=500)
    except Exception as exc:  # pragma: no cover
        raise PlaygroundError(f"Unexpected error: {exc}", status=500)


@api.route("/media/align", methods=["POST"])
def media_align_endpoint():
    """WhisperX alignment on an existing media job. Currently aligns full transcript.

    Body: { jobId }
    """
    if not (WHISPERX_ENABLE and _have_whisperx):
        raise PlaygroundError("WhisperX alignment is not enabled on this server.", status=503)
    payload = parse_json_request()
    job_id = str(payload.get("jobId") or "").strip()
    if not job_id:
        raise PlaygroundError("Field 'jobId' is required.", status=400)
    job_dir = _media_job_dir(job_id)
    audio_wav = job_dir / "source.wav"
    tx_path = job_dir / "transcript.json"
    if not audio_wav.exists() or not tx_path.exists():
        raise PlaygroundError("Source audio or transcript is missing for this job.", status=404)
    # Load transcript
    transcript = json.loads(tx_path.read_text(encoding="utf-8"))
    prev_words = transcript.get('words') or []
    # Align
    t0 = time.time()
    aligned = _whisperx_align_full(audio_wav, transcript)
    elapsed = max(time.time() - t0, 0.0)
    # Persist
    try:
        with open(tx_path, "w", encoding="utf-8") as f:
            json.dump(aligned, f)
    except Exception:
        pass
    rel_audio = (audio_wav.relative_to(OUTPUT_DIR)).as_posix()
    try:
        _record_stat("align_full", {"jobId": job_id, "elapsed": elapsed, "duration": float(aligned.get("duration", 0) or 0), "words": len(aligned.get("words", []) or []), "ts": time.time()})
    except Exception:
        pass
    diff = _alignment_diff_stats(prev_words, aligned.get('words') or [])
    return jsonify({
        "jobId": job_id,
        "media": {"audio_url": f"/audio/{rel_audio}", "duration": aligned.get("duration", 0)},
        "transcript": aligned,
        "stats": {"elapsed": elapsed, "words": len(aligned.get("words", []) or []), "diff": diff},
        "whisperx": {"enabled": True}
    })


@api.route("/media/align_region", methods=["POST"])
def media_align_region_endpoint():
    """Run WhisperX only on a selected region to refine timings lazily.

    Body: { jobId, start: number, end: number, margin?: number }
    Returns: { jobId, region, transcript }
    """
    if not (WHISPERX_ENABLE and _have_whisperx):
        raise PlaygroundError("WhisperX alignment is not enabled on this server.", status=503)
    payload = parse_json_request()
    job_id = str(payload.get("jobId") or "").strip()
    if not job_id:
        raise PlaygroundError("Field 'jobId' is required.", status=400)
    try:
        start = float(payload.get("start"))
        end = float(payload.get("end"))
    except Exception:
        raise PlaygroundError("Fields 'start' and 'end' must be numbers (seconds).", status=400)
    margin = payload.get("margin")
    try:
        margin_s = float(margin) if margin is not None else 0.75
    except Exception:
        margin_s = 0.75
    if end <= start:
        raise PlaygroundError("'end' must be greater than 'start'.", status=400)

    job_dir = _media_job_dir(job_id)
    audio_wav = job_dir / "source.wav"
    tx_path = job_dir / "transcript.json"
    if not audio_wav.exists() or not tx_path.exists():
        raise PlaygroundError("Source audio or transcript is missing for this job.", status=404)

    # Load full transcript
    transcript = json.loads(tx_path.read_text(encoding="utf-8"))
    duration = float(transcript.get("duration") or _ffprobe_duration_seconds(audio_wav))
    region_start = max(0.0, start - max(0.0, margin_s))
    region_end = min(duration, end + max(0.0, margin_s))

    # Build text for the region from existing segments/words
    words = transcript.get("words") or []
    def _is_timed_word(obj: Any) -> bool:
        return isinstance(obj, dict) and ("start" in obj) and ("end" in obj)
    region_text = ""
    if words and all(_is_timed_word(w) for w in words):
        region_words = [
            w for w in words
            if float(w.get("end", 0)) > region_start and float(w.get("start", 0)) < region_end
        ]
        words_txt = [str((w.get("text") or w.get("word") or "")).strip() for w in region_words]
        region_text = " ".join(words_txt).strip()
    if not region_text:
        segs = transcript.get("segments") or []
        region_segs = [
            s for s in segs
            if float(s.get("end", 0)) > region_start and float(s.get("start", 0)) < region_end
        ]
        region_text = " ".join(str(s.get("text") or "").strip() for s in region_segs).strip()
    if not region_text:
        raise PlaygroundError("No transcript content found in the selected region.", status=400)

    _log(f"WhisperX region requested: job={job_id} start={start:.2f} end={end:.2f} margin={margin_s:.2f} -> window {region_start:.2f}-{region_end:.2f}")
    # Trim audio for the region
    region_wav = job_dir / f"region-{int(region_start*1000)}-{int(region_end*1000)}.wav"
    try:
        _extract_input_to_wav(audio_wav, region_wav, start=region_start, end=region_end)
    except Exception:
        # fallback call: direct trim
        cmd = [
            "ffmpeg", "-y", "-ss", str(region_start), "-to", str(region_end), "-i", str(audio_wav),
            "-ac", "1", "-ar", "24000", str(region_wav)
        ]
        _log(f"ffmpeg region trim fallback: ss={region_start} to={region_end} src='{audio_wav}' out='{region_wav}'")
        subprocess.run(cmd, check=True)

    # Prepare WhisperX result input with one segment covering region_text
    wx_result = {"language": transcript.get("language", "en"), "segments": [{"text": region_text, "start": 0.0, "end": float(region_end - region_start)}]}
    align_model, metadata = _whisperx_get_align_model(str(transcript.get("language", "en")))
    t0 = time.time()
    try:
        aligned = whisperx.align(wx_result["segments"], align_model, metadata, str(region_wav), device=WHISPERX_DEVICE, return_char_alignments=False)  # type: ignore[name-defined]
    except Exception as exc:
        _log(f"WhisperX align failed: {exc}")
        raise PlaygroundError(f"WhisperX alignment failed: {exc}", status=500)
    elapsed = max(time.time() - t0, 0.0)
    new_words: List[Dict[str, Any]] = []
    for seg in aligned.get("segments", []):
        for w in seg.get("words", []) or []:
            if not isinstance(w, dict):
                continue
            abs_start = region_start + float(w.get("start") or 0)
            abs_end = region_start + float(w.get("end") or 0)
            new_words.append({
                "text": str(w.get("word") or w.get("text") or "").strip(),
                "start": abs_start,
                "end": abs_end,
                "confidence": float(w.get("score") or 0),
            })
    # Merge new words into transcript, replacing overlap area
    existing = transcript.get("words") or []
    kept: List[Dict[str, Any]] = []
    for w in existing:
        if not _is_timed_word(w):
            continue
        if not (float(w.get("end", 0)) > region_start and float(w.get("start", 0)) < region_end):
            kept.append({
                "text": str((w.get("text") or w.get("word") or "")).strip(),
                "start": float(w.get("start") or 0),
                "end": float(w.get("end") or 0),
                "confidence": float(w.get("confidence") or w.get("score") or 0),
            })
    merged = kept + new_words
    merged.sort(key=lambda w: float(w.get("start", 0)))
    transcript["words"] = merged

    # Persist
    try:
        with open(tx_path, "w", encoding="utf-8") as f:
            json.dump(transcript, f)
    except Exception:
        pass

    _log(f"WhisperX region align: job={job_id} request=({start:.2f}-{end:.2f}s, margin={margin_s:.2f}) used=({region_start:.2f}-{region_end:.2f}s) words={len(new_words)} elapsed={elapsed:.2f}s rtf={(region_end-region_start)/max(elapsed,1e-6):.2f}x")
    rel_audio = (audio_wav.relative_to(OUTPUT_DIR)).as_posix()
    try:
        _record_stat("align_region", {"jobId": job_id, "elapsed": elapsed, "region": {"start": start, "end": end, "used": {"start": region_start, "end": region_end}}, "words": len(new_words), "duration": float(region_end-region_start), "rtf": (region_end-region_start)/max(elapsed,1e-6), "ts": time.time()})
    except Exception:
        pass
    diff = _alignment_diff_stats(prev_words, transcript.get("words") or [], window=(region_start, region_end))
    return jsonify({
        "jobId": job_id,
        "region": {"start": start, "end": end, "margin": margin_s, "used": {"start": region_start, "end": region_end}},
        "media": {"audio_url": f"/audio/{rel_audio}", "duration": duration},
        "transcript": transcript,
        "stats": {"elapsed": elapsed, "rtf": (region_end-region_start)/max(elapsed,1e-6), "words": len(new_words), "diff": diff},
        "whisperx": {"enabled": True}
    })


@api.route("/media/stats", methods=["GET"])
def media_stats_endpoint():
    """Return aggregate timing summaries for recent media operations (for ETA)."""
    stats_path = OUTPUT_DIR / "media_stats.json"
    summary: Dict[str, Any] = {"transcribe": {"avg_rtf": None, "count": 0}, "align_full": {"avg_rtf": None, "count": 0}, "align_region": {"avg_rtf": None, "count": 0}}
    try:
        if stats_path.exists():
            data = json.loads(stats_path.read_text(encoding="utf-8"))
            # transcribe: rtf directly
            trans = data.get("transcribe", []) or []
            rtf_vals = [float(s.get("rtf", 0)) for s in trans if isinstance(s, dict) and float(s.get("rtf", 0) or 0) > 0]
            if rtf_vals:
                summary["transcribe"] = {"avg_rtf": sum(rtf_vals) / len(rtf_vals), "count": len(rtf_vals)}
            # align_full: derive rtf=duration/elapsed
            full = data.get("align_full", []) or []
            rtf_full = []
            for s in full:
                if not isinstance(s, dict):
                    continue
                dur = float(s.get("duration", 0) or 0)
                el = float(s.get("elapsed", 0) or 0)
                if el > 0 and dur > 0:
                    rtf_full.append(dur / el)
            if rtf_full:
                summary["align_full"] = {"avg_rtf": sum(rtf_full) / len(rtf_full), "count": len(rtf_full)}
            # align_region: rtf directly
            reg = data.get("align_region", []) or []
            rtf_reg = [float(s.get("rtf", 0)) for s in reg if isinstance(s, dict) and float(s.get("rtf", 0) or 0) > 0]
            if rtf_reg:
                summary["align_region"] = {"avg_rtf": sum(rtf_reg) / len(rtf_reg), "count": len(rtf_reg)}
    except Exception:
        pass
    return jsonify(summary)


def _yt_id_from_url(u: str) -> Optional[str]:
    try:
        m = re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{6,})", u)
        return m.group(1) if m else None
    except Exception:
        return None


def _youtube_cache_find(vid: str) -> Optional[Path]:
    try:
        cache_dir = OUTPUT_DIR / "media_cache" / "youtube"
        if not cache_dir.exists():
            return None
        candidates = list(cache_dir.glob(f"{vid}.*"))
        if not candidates:
            return None
        return max(candidates, key=lambda p: p.stat().st_size)
    except Exception:
        return None


def _youtube_meta_path(vid: str) -> Path:
    cache_dir = OUTPUT_DIR / "media_cache" / "youtube"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / f"{vid}.info.json"


def _youtube_meta_load(vid: str) -> Optional[Dict[str, Any]]:
    try:
        p = _youtube_meta_path(vid)
        if not p.exists():
            return None
        return json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        return None


def _youtube_meta_save(vid: str, data: Dict[str, Any]) -> None:
    try:
        p = _youtube_meta_path(vid)
        p.write_text(json.dumps(data), encoding='utf-8')
    except Exception:
        pass


def _yt_dlp_info_json(url: str) -> Dict[str, Any]:
    if not _have_tool('yt-dlp'):
        raise PlaygroundError("yt-dlp is required to fetch metadata.", status=503)
    cmd = ['yt-dlp', '-j']
    try:
        if YT_DLP_COOKIES_PATH.exists():
            cmd += ['--cookies', str(YT_DLP_COOKIES_PATH)]
    except Exception:
        pass
    if YT_DLP_EXTRACTOR_ARGS.strip():
        cmd += ['--extractor-args', YT_DLP_EXTRACTOR_ARGS.strip()]
    cmd.append(url)
    proc = subprocess.run(cmd, capture_output=True, text=True, check=True)
    data = json.loads(proc.stdout.splitlines()[0]) if proc.stdout else {}
    return data

@api.route("/media/estimate", methods=["POST"])
def media_estimate_endpoint():
    """Estimate media duration and basic metadata for ETA/preview.

    Body: { source: 'youtube', url }
    Returns: {
      duration: number,
      cached?: boolean,
      title?: string,
      uploader?: string,
      upload_date?: string,
      view_count?: int,
      thumbnail_url?: string,
      webpage_url?: string,
      channel_url?: string,
      like_count?: int
    }
    """
    # Opportunistic cleanup of old media artifacts
    _maybe_cleanup_media_artifacts()
    payload = parse_json_request()
    source = str(payload.get('source') or '').strip().lower()
    if source != 'youtube':
        raise PlaygroundError("Only YouTube source is supported for estimate.", status=400)
    url = str(payload.get('url') or '').strip()
    if not url:
        raise PlaygroundError("Field 'url' is required.", status=400)
    vid = _yt_id_from_url(url)
    # Try from cache first
    if vid:
        cached = _youtube_cache_find(vid)
        if cached and cached.exists():
            out: Dict[str, Any] = { 'duration': _ffprobe_duration_seconds(cached), 'cached': True }
            # First try metadata cache
            cached_meta = _youtube_meta_load(vid)
            if cached_meta:
                out.update({
                    'title': cached_meta.get('title') or None,
                    'uploader': cached_meta.get('uploader') or cached_meta.get('channel') or None,
                    'upload_date': cached_meta.get('upload_date') or None,
                    'view_count': cached_meta.get('view_count') or None,
                    'thumbnail_url': cached_meta.get('thumbnail') or None,
                    'webpage_url': cached_meta.get('webpage_url') or url,
                    'channel_url': cached_meta.get('channel_url') or None,
                    'like_count': cached_meta.get('like_count') or None,
                })
                return jsonify(out)
            # If no meta cache yet, try to fetch once and save
            if _have_tool('yt-dlp'):
                try:
                    data = _yt_dlp_info_json(url)
                    _youtube_meta_save(vid, data)
                    out.update({
                        'title': data.get('title') or None,
                        'uploader': data.get('uploader') or data.get('channel') or None,
                        'upload_date': data.get('upload_date') or None,
                        'view_count': data.get('view_count') or None,
                        'thumbnail_url': data.get('thumbnail') or None,
                        'webpage_url': data.get('webpage_url') or url,
                        'channel_url': data.get('channel_url') or None,
                        'like_count': data.get('like_count') or None,
                    })
                except Exception:
                    pass
            return jsonify(out)
    # Fallback: yt-dlp JSON
    if not _have_tool('yt-dlp'):
        raise PlaygroundError("yt-dlp is required to estimate duration.", status=503)
    try:
        data = _yt_dlp_info_json(url)
        dur = float(data.get('duration') or 0)
        if dur <= 0:
            raise ValueError('No duration from yt-dlp')
        result = {
            'duration': dur,
            'cached': False,
            'title': data.get('title') or None,
            'uploader': data.get('uploader') or data.get('channel') or None,
            'upload_date': data.get('upload_date') or None,
            'view_count': data.get('view_count') or None,
            'thumbnail_url': data.get('thumbnail') or None,
            'webpage_url': data.get('webpage_url') or url,
            'channel_url': data.get('channel_url') or None,
            'like_count': data.get('like_count') or None,
        }
        if vid:
            _youtube_meta_save(vid, data)
        return jsonify(result)
    except Exception as exc:
        raise PlaygroundError(f"Could not estimate duration: {exc}", status=500)


def _ffprobe_json(path: Path) -> Dict[str, Any]:
    if not _have_tool('ffprobe'):
        raise PlaygroundError("ffprobe is required to analyze files.", status=503)
    try:
        proc = subprocess.run(
            ['ffprobe', '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', str(path)],
            capture_output=True, text=True, check=True
        )
        return json.loads(proc.stdout or '{}')
    except Exception as exc:  # pragma: no cover
        raise PlaygroundError(f"ffprobe failed: {exc}", status=500)


@api.route('/media/probe', methods=['POST'])
def media_probe_endpoint():
    """Inspect an uploaded media file without starting a job.

    Accepts: multipart/form-data with field 'file'
    Returns: {
      duration: number,
      size_bytes: int,
      format: string,
      has_video: bool,
      audio?: { codec?: str, sample_rate?: int, channels?: int },
      video?: { codec?: str, width?: int, height?: int, fps?: float }
    }
    """
    up = request.files.get('file')
    if not up or not up.filename:
        raise PlaygroundError("No file uploaded.", status=400)
    suffix = Path(up.filename).suffix or '.dat'
    tmp_dir = OUTPUT_DIR / 'media_probe'
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = tmp_dir / f"probe-{uuid.uuid4().hex}{suffix}"
    up.save(str(tmp_path))
    try:
        info = _ffprobe_json(tmp_path)
        fmt = (info.get('format') or {})
        size_bytes = int(float(fmt.get('size') or 0))
        duration = float(fmt.get('duration') or 0.0)
        streams = info.get('streams') or []
        audio: Dict[str, Any] = {}
        video: Dict[str, Any] = {}
        has_video = False
        for s in streams:
            if s.get('codec_type') == 'audio' and not audio:
                sr = s.get('sample_rate')
                try:
                    sr_i = int(sr) if isinstance(sr, str) else int(sr or 0)
                except Exception:
                    sr_i = None
                audio = {
                    'codec': s.get('codec_name') or None,
                    'sample_rate': sr_i,
                    'channels': s.get('channels') or None,
                }
            elif s.get('codec_type') == 'video' and not video:
                has_video = True
                fps = None
                try:
                    r = s.get('r_frame_rate') or s.get('avg_frame_rate')
                    if isinstance(r, str) and '/' in r:
                        num, den = r.split('/')
                        num_f = float(num)
                        den_f = float(den) if float(den) != 0 else 1.0
                        fps = num_f / den_f
                except Exception:
                    fps = None
                video = {
                    'codec': s.get('codec_name') or None,
                    'width': s.get('width') or None,
                    'height': s.get('height') or None,
                    'fps': fps,
                }
        result = {
            'duration': duration,
            'size_bytes': size_bytes,
            'format': (fmt.get('format_name') or fmt.get('format_long_name') or 'unknown'),
            'has_video': has_video,
        }
        if audio:
            result['audio'] = audio
        if video:
            result['video'] = video
        return jsonify(result)
    finally:
        try:
            tmp_path.unlink(missing_ok=True)  # type: ignore[arg-type]
        except Exception:
            pass


@api.route("/media/replace_preview", methods=["POST"])
def media_replace_preview_endpoint():
    """Synthesize replacement audio (XTTS), fit to region, and return a patched preview.

    Body: { jobId, start, end, text, voice?, language?, speed?, marginMs?, fadeMs? }
      - If 'voice' is omitted, a temporary reference is borrowed from the selected region.
    Returns: { jobId, preview_url, diff_url, stats }
    """
    payload = parse_json_request()
    job_id = str(payload.get("jobId") or "").strip()
    if not job_id:
        raise PlaygroundError("Field 'jobId' is required.", status=400)
    try:
        start = float(payload.get("start"))
        end = float(payload.get("end"))
    except Exception:
        raise PlaygroundError("Fields 'start' and 'end' must be numbers (seconds).", status=400)
    if end <= start:
        raise PlaygroundError("'end' must be greater than 'start'.", status=400)
    text = str(payload.get("text") or "").strip()
    if not text:
        raise PlaygroundError("Field 'text' is required.", status=400)

    margin_ms = float(payload.get("marginMs", 0))
    fade_ms = float(payload.get("fadeMs", 30))
    duck_db = payload.get("duckDb")
    duck_gain: Optional[float] = None
    try:
        if duck_db is not None:
            duck_db_f = float(duck_db)
            # Convert dB to linear gain; clamp to [0, 1]
            duck_gain = max(0.0, min(1.0, 10.0 ** (duck_db_f / 20.0)))
    except Exception:
        duck_gain = None
    language = str(payload.get("language") or "")
    speed = float(payload.get("speed") or 1.0)
    explicit_voice = payload.get("voice")  # could be id or path

    job_dir = _media_job_dir(job_id)
    audio_wav = job_dir / "source.wav"
    if not audio_wav.exists():
        raise PlaygroundError("Source WAV for this job is missing.", status=404)

    # Borrow voice from region if not provided
    region_start = start - (margin_ms / 1000.0 if margin_ms > 0 else 0.0)
    region_end = end + (margin_ms / 1000.0 if margin_ms > 0 else 0.0)
    source_dur = _ffprobe_duration_seconds(audio_wav)
    region_start = max(0.0, region_start)
    region_end = min(source_dur, region_end)
    ref_voice = None
    if explicit_voice:
        # Validate explicit voice input: allow known voice ids, or paths under job_dir or XTTS_VOICE_DIR
        ev = str(explicit_voice)
        # Heuristic: treat as path if it looks like one (absolute or contains a separator or has an audio extension)
        looks_path = False
        try:
            cand = Path(ev).expanduser()
            if cand.is_absolute() or os.sep in ev or cand.suffix.lower() in XTTS_SUPPORTED_EXTENSIONS:
                looks_path = True
        except Exception:
            looks_path = False
        if looks_path:
            try:
                real = cand.resolve()
            except Exception:
                raise PlaygroundError("Invalid 'voice' path provided.", status=400)
            allowed = False
            try:
                real.relative_to(job_dir.resolve())
                allowed = True
            except Exception:
                try:
                    real.relative_to(XTTS_VOICE_DIR.resolve())
                    allowed = True
                except Exception:
                    allowed = False
            if not allowed:
                raise PlaygroundError("'voice' path must be inside the current job folder or XTTS voices directory.", status=400)
            if not real.exists():
                raise PlaygroundError("Provided 'voice' path does not exist.", status=400)
            ref_voice = str(real)
        else:
            # Assume an XTTS voice identifier; let XTTS resolver validate later
            ref_voice = ev
    else:
        region_wav = job_dir / f"ref-{int(region_start*1000)}-{int(region_end*1000)}.wav"
        _extract_input_to_wav(audio_wav, region_wav, start=region_start, end=region_end)
        ref_voice = str(region_wav)

    # Determine language default from prior transcript
    tx_path = job_dir / "transcript.json"
    if not language and tx_path.exists():
        try:
            tx = json.loads(tx_path.read_text(encoding='utf-8'))
            language = str(tx.get('language') or 'en').lower()
        except Exception:
            language = 'en'
    if not language:
        language = 'en'

    # XTTS synthesize replacement
    xtts_payload = {
        'text': text,
        'voice': ref_voice,
        'language': language,
        'speed': speed,
        'format': 'wav',
        'sample_rate': 24000,
        'seed': 42,
        'temperature': 0.6,
    }
    data = _xtts_prepare_payload(xtts_payload)
    t0 = time.time()
    synth = _xtts_synthesise(data)
    elapsed_synth = max(time.time() - t0, 0.0)

    # Build preview: overlay replacement in region with crossfades
    src, sr = _load_wav_mono(audio_wav, target_sr=24000)
    rep_path = OUTPUT_DIR / synth['filename']
    rep, r_sr = _load_wav_mono(rep_path, target_sr=sr)
    # Optional: trim silence of synthesized segment to improve boundary precision
    trim_enable = bool(payload.get('trimEnable', True))
    trim_top_db = float(payload.get('trimTopDb', 40.0))
    trim_pre_ms = float(payload.get('trimPrepadMs', 8.0))
    trim_post_ms = float(payload.get('trimPostpadMs', 8.0))
    if trim_enable:
        rep = _trim_silence(rep, top_db=trim_top_db, sr=sr, prepad_ms=trim_pre_ms, postpad_ms=trim_post_ms)
    i0 = int(max(0.0, start) * sr)
    i1 = int(min(source_dur, end) * sr)
    # Stretch replacement to exact target length; reuse for both preview and optional alignment overlay
    target_len = max(i1 - i0, 1)
    rep_stretched = rep if len(rep) == target_len else _time_stretch_to_len(rep, sr, target_len)
    preview = _apply_replace_with_crossfade(src, rep_stretched, sr, i0, i1, fade_ms=fade_ms, duck_gain=duck_gain)

    # Write preview and diff
    ts = int(time.time())
    preview_path = job_dir / f"preview-{ts}.wav"
    diff_path = job_dir / f"diff-{ts}.wav"
    sf.write(preview_path, preview, sr)
    # diff clip (for debugging): only the inserted region with fades applied
    diff = np.zeros_like(src)
    diff[i0:i1] = preview[i0:i1] - src[i0:i1]
    sf.write(diff_path, diff, sr)

    # Update latest symlinks for apply step
    try:
        latest = job_dir / "latest_preview.wav"
        if latest.exists() or latest.is_symlink():
            try:
                latest.unlink()
            except OSError:
                pass
        try:
            latest.symlink_to(preview_path)
        except Exception:
            # fallback: copy
            sf.write(latest, preview, sr)
    except Exception:
        pass

    rel_prev = (preview_path.relative_to(OUTPUT_DIR)).as_posix()
    rel_diff = (diff_path.relative_to(OUTPUT_DIR)).as_posix()
    _log(f"Replace preview: job={job_id} region=({start:.2f}-{end:.2f}) synth={elapsed_synth:.2f}s preview='{rel_prev}'")
    out: Dict[str, Any] = {
        'jobId': job_id,
        'preview_url': f"/audio/{rel_prev}",
        'diff_url': f"/audio/{rel_diff}",
        'stats': { 'synth_elapsed': elapsed_synth, 'fade_ms': fade_ms, 'duck_db': duck_db }
    }

    # Optional: align replacement words on the stretched segment and return absolute timings
    try:
        align_replace = bool(payload.get('alignReplace'))
    except Exception:
        align_replace = False
    if align_replace and WHISPERX_ENABLE and _have_whisperx:
        try:
            # Persist stretched segment to a temporary WAV for WhisperX
            tmp_rep = job_dir / f"rep_stretched_{i0}_{i1}.wav"
            sf.write(tmp_rep, rep_stretched.astype('float32'), sr)
            # Build a simple segment with the replacement text spanning the clip
            seg = { 'text': text, 'start': 0.0, 'end': float(target_len) / float(sr) }
            align_model, metadata = _whisperx_get_align_model(language)
            aligned = whisperx.align([seg], align_model, metadata, str(tmp_rep), device=WHISPERX_DEVICE, return_char_alignments=False)  # type: ignore[name-defined]
            repl_words: List[Dict[str, Any]] = []
            for sseg in aligned.get('segments', []) or []:
                for w in sseg.get('words', []) or []:
                    try:
                        ws = float(w.get('start') or 0.0)
                        we = float(w.get('end') or 0.0)
                        txt = str(w.get('word') or w.get('text') or '').strip()
                        repl_words.append({ 'text': txt, 'start': start + ws, 'end': start + we })
                    except Exception:
                        continue
            if repl_words:
                out['replace_words'] = repl_words
        except Exception as exc:
            _log(f"alignReplace failed: {exc}")
            # non-fatal — preview still returned
        finally:
            try:
                tmp_rep.unlink(missing_ok=True)  # type: ignore[arg-type]
            except Exception:
                pass

    return jsonify(out)


@api.route("/media/apply", methods=["POST"])
def media_apply_endpoint():
    """Mux the latest preview audio back into the original container (video if available).

    Body: { jobId, format? }
    Returns: { jobId, final_url, mode: 'video'|'audio', container: string }
    """
    payload = parse_json_request()
    job_id = str(payload.get('jobId') or '').strip()
    if not job_id:
        raise PlaygroundError("Field 'jobId' is required.", status=400)
    job_dir = _media_job_dir(job_id)
    latest = job_dir / 'latest_preview.wav'
    if not latest.exists():
        raise PlaygroundError("No preview found for this job. Generate a replace preview first.", status=400)
    fmt = str(payload.get('format') or '').lower()

    # Read job meta
    has_video = False
    src_path: Optional[Path] = None
    meta_path = job_dir / 'job_meta.json'
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding='utf-8'))
            src_path = Path(str(meta.get('input_path') or '')) if meta.get('input_path') else None
            has_video = bool(meta.get('has_video'))
        except Exception:
            pass

    # Re-probe to be robust in case meta was wrong or stale
    if src_path and src_path.exists():
        has_video = _ffprobe_has_video(src_path)
    if has_video and src_path and src_path.exists():
        # Produce final video with original video stream and preview audio
        src_ext = src_path.suffix.lower() or '.mp4'
        out_ext = f".{fmt}" if fmt in {'mp4','mkv','mov','webm'} else src_ext
        final_path = job_dir / f"final{out_ext}"
        # Choose audio codec by container
        if out_ext in {'.webm'}:
            # WebM requires Opus/Vorbis; use Opus at 160 kbps and 48 kHz
            acodec = ['-c:a','libopus','-b:a','160k','-ar','48000']
        elif out_ext in {'.mp4','.m4v','.mov'}:
            # MP4/MOV commonly uses AAC
            acodec = ['-c:a','aac','-b:a','192k']
        else:
            # Fallback to AAC
            acodec = ['-c:a','aac','-b:a','192k']
        cmd = [
            'ffmpeg','-y',
            '-i', str(src_path),
            '-i', str(latest),
            '-map','0:v:0','-map','1:a:0',
            '-c:v','copy',
            *acodec,
            '-shortest',
            str(final_path)
        ]
        _log(f"Apply: mux video src='{src_path}' audio='{latest}' out='{final_path}'")
        try:
            # Capture stderr for diagnostics
            res = subprocess.run(cmd, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as exc:
            _log(f"ffmpeg mux error: {exc.stderr or exc.stdout}")
            # Fallback: if copy fails, try re-encode video to a compatible codec (vp9 for webm, h264 for mp4/mov)
            if out_ext == '.webm':
                vcodec = ['-c:v', 'libvpx-vp9', '-b:v', '1M']
                acodec = ['-c:a','libopus','-b:a','160k','-ar','48000']
            else:
                vcodec = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23']
                acodec = ['-c:a','aac','-b:a','192k']
            cmd2 = ['ffmpeg','-y','-i', str(src_path), '-i', str(latest), '-map','0:v:0','-map','1:a:0', *vcodec, *acodec, '-shortest', str(final_path)]
            _log(f"Apply fallback: re-encode video src='{src_path}' out='{final_path}'")
            res2 = subprocess.run(cmd2, check=True, capture_output=True, text=True)
        rel = (final_path.relative_to(OUTPUT_DIR)).as_posix()
        return jsonify({'jobId': job_id, 'final_url': f"/audio/{rel}", 'mode': 'video', 'container': out_ext.lstrip('.')})
    else:
        # Audio-only final
        final_path = job_dir / 'final.wav'
        # Copy latest to final
        audio, sr = _load_wav_mono(latest, target_sr=None)
        sf.write(final_path, audio, sr)
        rel = (final_path.relative_to(OUTPUT_DIR)).as_posix()
        _log(f"Apply: audio-only final='{final_path}'")
        return jsonify({'jobId': job_id, 'final_url': f"/audio/{rel}", 'mode': 'audio', 'container': 'wav'})
@api.route("/meta", methods=["GET"])
def meta_endpoint():
    has_model = MODEL_PATH.exists()
    has_voices = VOICES_PATH.exists()
    bundle_index = FRONTEND_DIST / "index.html"
    ollama_info = list_ollama_models()
    kokoro_voice_payload = build_kokoro_voice_payload()
    accent_groups = kokoro_voice_payload["accentGroups"]
    engines_meta = [serialise_engine_meta(engine) for engine in ENGINE_REGISTRY.values()]

    # Helpful URL hints for peers (frontends may show these in a footer)
    def _url(host: str | None) -> str | None:
        if not host:
            return None
        prefix = f"/{API_PREFIX}" if API_PREFIX else ""
        return f"http://{host}:{BACKEND_PORT}{prefix}"

    payload = {
        "api_prefix": API_PREFIX,
        "port": BACKEND_PORT,
        "has_model": has_model,
        "has_voices": has_voices,
        "random_categories": RANDOM_CATEGORIES,
        "accent_groups": accent_groups,
        "voice_count": kokoro_voice_payload["count"],
        "frontend_bundle": {"path": str(FRONTEND_DIST), "available": bundle_index.is_file()},
        "ollama_available": bool(ollama_info.get("models")),
        "engines": engines_meta,
        "default_engine": DEFAULT_TTS_ENGINE,
        # Hints added for UI status
        "bind_host": BACKEND_HOST,
        "public_host": PUBLIC_HOST,
        "lan_ip": LAN_IP,
        "urls": {
            "local": _url("127.0.0.1"),
            "bind": _url(BACKEND_HOST),
            "lan": _url(LAN_IP) if LAN_IP else None,
            "wg": _url(PUBLIC_HOST) if PUBLIC_HOST else None,
        },
    }
    return jsonify(payload)


@api.route("/voices", methods=["GET"])
def voices_endpoint():
    engine_id = request.args.get("engine")
    engine, available = resolve_engine(engine_id, allow_unavailable=True)

    if not available:
        return jsonify(
            {
                "engine": engine["id"],
                "available": False,
                "voices": [],
                "accentGroups": [],
                "groups": [],
                "count": 0,
            }
        )

    payload_factory = engine.get("fetch_voices")
    voice_payload = payload_factory() if callable(payload_factory) else {}

    voices = voice_payload.get("voices", [])
    groups = voice_payload.get("accentGroups") or voice_payload.get("groups") or []

    response = {
        "engine": engine["id"],
        "available": True,
        "voices": voices,
        "accentGroups": groups,
        "groups": groups,
        "count": voice_payload.get("count", len(voices)),
    }
    if "presets" in voice_payload:
        response["presets"] = voice_payload["presets"]
    if "styles" in voice_payload:
        response["styles"] = voice_payload["styles"]
    if not voices and engine["id"] != "kokoro":
        response["message"] = "Voice catalogue not yet implemented for this engine."
    return jsonify(response)


@api.route("/voices_grouped", methods=["GET"])
def voices_grouped_endpoint():
    engine_id = request.args.get("engine")
    engine, available = resolve_engine(engine_id, allow_unavailable=True)

    if not available:
        return jsonify(
            {
                "engine": engine["id"],
                "available": False,
                "accentGroups": [],
                "groups": [],
                "count": 0,
            }
        )

    payload_factory = engine.get("fetch_voices")
    voice_payload = payload_factory() if callable(payload_factory) else {}
    groups = voice_payload.get("accentGroups") or voice_payload.get("groups") or []
    response = {
        "engine": engine["id"],
        "available": True,
        "accentGroups": groups,
        "groups": groups,
        "count": voice_payload.get("count", 0),
    }
    if not groups and engine["id"] != "kokoro":
        response["message"] = "Grouped voice metadata not yet implemented for this engine."
    return jsonify(response)


# Ollama proxy endpoints (after blueprint creation)
def _ollama_base() -> str:
    return os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")


# Draw Things (Stable Diffusion) HTTP API proxy helpers
def _drawthings_base() -> str:
    """Return Draw Things HTTP API base.

    Draw Things exposes an AUTOMATIC1111-compatible HTTP API when enabled in the app.
    By default we assume it's listening on localhost:7859.
    Set DRAWTHINGS_URL to override, e.g. http://127.0.0.1:7859 or https://<host>:7859
    """
    return os.environ.get("DRAWTHINGS_URL", "http://127.0.0.1:7859").rstrip("/")


@api.route("/ollama/tags", methods=["GET"])
def ollama_tags_proxy():
    import requests
    url = f"{_ollama_base()}/api/tags"
    try:
        res = requests.get(url, timeout=20)
        res.raise_for_status()
        return jsonify(res.json())
    except Exception as exc:  # pragma: no cover
        raise PlaygroundError(f"Ollama /tags failed: {exc}", status=503)


@api.route("/ollama/generate", methods=["POST"])
def ollama_generate_proxy():
    import requests
    body = parse_json_request()
    stream = bool(body.get("stream"))
    url = f"{_ollama_base()}/api/generate"
    try:
        if stream:
            def _proxy():
                # Send an initial event so clients see liveness quickly
                yield 'data: {"status":"starting"}\n\n'
                with requests.post(url, json=body, stream=True, timeout=None) as r:
                    r.raise_for_status()
                    for line in r.iter_lines(decode_unicode=True):
                        if not line:
                            continue
                        yield f"data: {line}\n\n"
            headers = {
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            }
            return Response(_proxy(), mimetype="text/event-stream", headers=headers)
        # non-streaming
        body.setdefault("stream", False)
        res = requests.post(url, json=body, timeout=120)
        res.raise_for_status()
        return jsonify(res.json())
    except Exception as exc:  # pragma: no cover
        raise PlaygroundError(f"Ollama /generate failed: {exc}", status=503)


@api.route("/ollama/chat", methods=["POST"])
def ollama_chat_proxy():
    import requests
    body = parse_json_request()
    stream = bool(body.get("stream"))
    url = f"{_ollama_base()}/api/chat"
    try:
        if stream:
            def _proxy():
                yield 'data: {"status":"starting"}\n\n'
                with requests.post(url, json=body, stream=True, timeout=None) as r:
                    r.raise_for_status()
                    for line in r.iter_lines(decode_unicode=True):
                        if not line:
                            continue
                        yield f"data: {line}\n\n"
            headers = {
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            }
            return Response(_proxy(), mimetype="text/event-stream", headers=headers)
        # non-streaming
        body.setdefault("stream", False)
        res = requests.post(url, json=body, timeout=120)
        res.raise_for_status()
        return jsonify(res.json())
    except Exception as exc:  # pragma: no cover
        raise PlaygroundError(f"Ollama /chat failed: {exc}", status=503)


# -------------------- Draw Things (Stable Diffusion) HTTP API proxies --------------------

@api.route("/drawthings/models", methods=["GET"])
def drawthings_models_proxy():
    """Proxy to Draw Things list of models (A1111-compatible: /sdapi/v1/sd-models)."""
    import requests
    url = f"{_drawthings_base()}/sdapi/v1/sd-models"
    try:
        res = requests.get(url, timeout=10)
        res.raise_for_status()
        return jsonify(res.json())
    except requests.HTTPError as http_exc:  # pragma: no cover
        # Some Draw Things builds do not implement /sdapi/v1/sd-models → return empty []
        if getattr(http_exc.response, "status_code", None) == 404:
            return jsonify([])
        raise PlaygroundError(f"DrawThings /sd-models failed: {http_exc}", status=503)
    except Exception as exc:  # pragma: no cover
        raise PlaygroundError(f"DrawThings /sd-models failed: {exc}", status=503)


@api.route("/drawthings/samplers", methods=["GET"])
def drawthings_samplers_proxy():
    import requests
    url = f"{_drawthings_base()}/sdapi/v1/samplers"
    try:
        res = requests.get(url, timeout=10)
        res.raise_for_status()
        return jsonify(res.json())
    except requests.HTTPError as http_exc:  # pragma: no cover
        if getattr(http_exc.response, "status_code", None) == 404:
            return jsonify([])
        raise PlaygroundError(f"DrawThings /samplers failed: {http_exc}", status=503)
    except Exception as exc:  # pragma: no cover
        raise PlaygroundError(f"DrawThings /samplers failed: {exc}", status=503)


@api.route("/drawthings/txt2img", methods=["POST"])
def drawthings_txt2img_proxy():
    """Proxy to Draw Things txt2img (A1111-compatible: /sdapi/v1/txt2img).

    Body is forwarded as JSON. Response is returned verbatim (typically includes base64 images).
    """
    import requests
    body = parse_json_request()
    url = f"{_drawthings_base()}/sdapi/v1/txt2img"
    try:
        res = requests.post(url, json=body, timeout=None)
        res.raise_for_status()
        # Return JSON payload (usually: { images: [b64...], parameters: {..}, info: "..." })
        return jsonify(res.json())
    except Exception as exc:  # pragma: no cover
        raise PlaygroundError(f"DrawThings /txt2img failed: {exc}", status=503)


@api.route("/drawthings/img2img", methods=["POST"])
def drawthings_img2img_proxy():
    """Proxy to Draw Things img2img (A1111-compatible: /sdapi/v1/img2img)."""
    import requests
    body = parse_json_request()
    url = f"{_drawthings_base()}/sdapi/v1/img2img"
    try:
        res = requests.post(url, json=body, timeout=None)
        res.raise_for_status()
        return jsonify(res.json())
    except Exception as exc:  # pragma: no cover
        raise PlaygroundError(f"DrawThings /img2img failed: {exc}", status=503)


# -------------------- Convenience: Telegram-friendly Draw endpoint --------------------

def _round_dim(value: int, *, minimum: int = 64, maximum: int = 1024, multiple: int = 8) -> int:
    try:
        v = int(value)
    except Exception:
        v = minimum
    v = max(minimum, min(maximum, v))
    # round to nearest multiple
    v = max(multiple, int(round(v / multiple) * multiple))
    return v


@api.route("/telegram/draw", methods=["POST"])
def telegram_draw_endpoint():
    """Simple prompt-in → PNG-out helper.

    Body: { prompt: string, width?: int, height?: int, steps?: int, seed?: int, negative?: string,
            sampler?: string, cfgScale?: float }

    Returns: { url, filename, width, height, steps, seed?, sampler?, provider: 'drawthings' }
    """
    import requests

    payload = parse_json_request()
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        raise PlaygroundError("Field 'prompt' is required.", status=400)

    preset = str(payload.get("preset") or "").strip().lower().replace(" ", "_")

    # Preset map (fills defaults; caller can override in payload)
    PRESETS = {
        # FLUX.1 [schnell]
        "flux_fast":      {"sampler": "Euler a",                 "steps": 6,  "cfg": 4.5, "w": 512, "h": 512},
        "flux_balanced":  {"sampler": "DPM++ SDE Karras",       "steps": 14, "cfg": 5.5, "w": 640, "h": 512},
        "flux_photoreal": {"sampler": "DPM++ 2M SDE Karras",    "steps": 18, "cfg": 5.5, "w": 768, "h": 512},
        # General SDXL/SD1.x style presets
        "fast":           {"sampler": "Euler a",                 "steps": 18, "cfg": 6.0, "w": 512, "h": 512},
        "balanced":       {"sampler": "DPM++ 2M Karras",        "steps": 28, "cfg": 6.5, "w": 768, "h": 512},
        "illustration":   {"sampler": "DPM++ 2S a Karras",      "steps": 28, "cfg": 7.5, "w": 640, "h": 640},
        "anime":          {"sampler": "Euler a",                 "steps": 24, "cfg": 8.0, "w": 640, "h": 640},
    }

    # Dimensions: allow preset defaults, then override by payload
    width = payload.get("width")
    height = payload.get("height")
    if width is None or height is None:
        if preset in PRESETS:
            width = width if width is not None else PRESETS[preset]["w"]
            height = height if height is not None else PRESETS[preset]["h"]
        else:
            width = width if width is not None else 512
            height = height if height is not None else 512
    width = _round_dim(int(width))
    height = _round_dim(int(height))
    try:
        steps = int(payload.get("steps", 20))
    except Exception:
        steps = 20
    steps = max(1, min(steps, 50))
    seed = payload.get("seed")
    negative = payload.get("negative") or payload.get("negative_prompt") or ""
    # Apply preset sampler/steps/cfgScale when not explicitly provided
    sampler = payload.get("sampler") or payload.get("sampler_name")
    if not sampler and preset in PRESETS:
        sampler = PRESETS[preset]["sampler"]
    sampler = str(sampler or "Euler a")
    try:
        cfg_scale = float(payload.get("cfgScale", payload.get("cfg_scale", PRESETS.get(preset, {}).get("cfg", 7.0))))
    except Exception:
        cfg_scale = 7.0
    cfg_scale = max(1.0, min(cfg_scale, 20.0))

    upstream = {
        "prompt": prompt,
        "negative_prompt": str(negative),
        "width": width,
        "height": height,
        "steps": int(payload.get("steps", PRESETS.get(preset, {}).get("steps", steps))),
        "sampler_name": sampler,
        "cfg_scale": cfg_scale,
        "batch_size": 1,
        "n_iter": 1,
    }
    # Optional checkpoint switch
    model = payload.get("model") or payload.get("checkpoint")
    if model:
        upstream["override_settings"] = {"sd_model_checkpoint": str(model)}
        upstream["override_settings_restore_afterwards"] = True
    if seed is not None:
        try:
            upstream["seed"] = int(seed)
        except Exception:
            pass

    url = f"{_drawthings_base()}/sdapi/v1/txt2img"
    try:
        res = requests.post(url, json=upstream, timeout=None)
        res.raise_for_status()
        data = res.json()
        images = data.get("images") or []
        if not images:
            raise PlaygroundError("No image returned from Draw Things.", status=502)
        img_b64 = images[0]
        if isinstance(img_b64, str) and img_b64.startswith("data:image"):
            img_b64 = img_b64.split(",", 1)[-1]
        try:
            img_bytes = base64.b64decode(img_b64, validate=False)
        except Exception as exc:  # pragma: no cover
            raise PlaygroundError(f"Failed to decode image: {exc}", status=500)
        filename = f"{int(time.time())}-{uuid.uuid4().hex[:10]}.png"
        out_path = DRAWTHINGS_IMAGE_DIR / filename
        with open(out_path, "wb") as f:
            f.write(img_bytes)
        return jsonify(
            {
                "url": f"/image/drawthings/{filename}",
                "filename": filename,
                "width": width,
                "height": height,
                "steps": steps,
                "seed": upstream.get("seed"),
                "sampler": sampler,
                "provider": "drawthings",
            }
        )
    except PlaygroundError:
        raise
    except Exception as exc:  # pragma: no cover
        raise PlaygroundError(f"DrawThings /telegram/draw failed: {exc}", status=503)


@api.route("/ollama/pull", methods=["POST"])
def ollama_pull_proxy():
    """Proxy to Ollama /api/pull. Supports streaming (SSE) or final JSON.

    Body accepts { model: "name", stream?: bool } or { name: "name", stream?: bool }
    """
    import requests

    body = parse_json_request()
    name = str(body.get("model") or body.get("name") or "").strip()
    if not name:
        raise PlaygroundError("Field 'model' is required.", status=400)
    upstream = {"name": name}
    stream = bool(body.get("stream", True))
    if not stream:
        upstream["stream"] = False
    url = f"{_ollama_base()}/api/pull"
    try:
        if stream:
            def _proxy():
                yield 'data: {"status":"starting"}\n\n'
                with requests.post(url, json=upstream, stream=True, timeout=None) as r:
                    r.raise_for_status()
                    for line in r.iter_lines(decode_unicode=True):
                        if not line:
                            continue
                        yield f"data: {line}\n\n"
            headers = {
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            }
            return Response(_proxy(), mimetype="text/event-stream", headers=headers)
        res = requests.post(url, json=upstream, timeout=None)
        res.raise_for_status()
        return jsonify(res.json())
    except Exception as exc:  # pragma: no cover
        raise PlaygroundError(f"Ollama /pull failed: {exc}", status=503)


@api.route("/ollama/ps", methods=["GET"])
def ollama_ps_proxy():
    import requests
    url = f"{_ollama_base()}/api/ps"
    try:
        res = requests.get(url, timeout=10)
        res.raise_for_status()
        return jsonify(res.json())
    except Exception as exc:  # pragma: no cover
        raise PlaygroundError(f"Ollama /ps failed: {exc}", status=503)


@api.route("/ollama/show", methods=["GET", "POST"])
def ollama_show_proxy():
    import requests
    if request.method == "GET":
        model = request.args.get("model") or request.args.get("name")
    else:
        data = parse_json_request()
        model = data.get("model") or data.get("name")
    if not model:
        raise PlaygroundError("Provide ?model=name or body {model:name}", status=400)
    url = f"{_ollama_base()}/api/show"
    try:
        res = requests.post(url, json={"name": model}, timeout=20)
        res.raise_for_status()
        return jsonify(res.json())
    except Exception as exc:  # pragma: no cover
        raise PlaygroundError(f"Ollama /show failed: {exc}", status=503)


@api.route("/ollama/delete", methods=["POST", "GET"])
def ollama_delete_proxy():
    """Delete a model from the local Ollama store.

    GET:  /ollama/delete?model=name or ?name=name
    POST: { model: name } or { name: name }
    """
    import requests

    if request.method == "GET":
        model = request.args.get("model") or request.args.get("name")
    else:
        data = parse_json_request()
        model = data.get("model") or data.get("name")
    if not model:
        raise PlaygroundError("Provide ?model=name or body {model:name}", status=400)
    url = f"{_ollama_base()}/api/delete"
    import requests
    try:
        # Ollama expects DELETE /api/delete with JSON body { name }
        res = requests.delete(url, json={"name": model}, timeout=30)
        res.raise_for_status()
        return jsonify(res.json())
    except requests.HTTPError as http_exc:  # pragma: no cover
        code = getattr(http_exc.response, 'status_code', None)
        # Fallback: some Ollama versions may not expose /api/delete; try CLI when allowed
        allow_cli = (os.environ.get('OLLAMA_ALLOW_CLI', '1').lower() in {'1','true','yes','on'})
        if code in (404, 405) and allow_cli:
            try:
                import shutil, subprocess, re
                bin_path = shutil.which('ollama')
                if not bin_path:
                    raise RuntimeError('ollama binary not found on PATH')
                proc = subprocess.run([bin_path, 'rm', model], capture_output=True, text=True, timeout=120)
                def _strip(s: str) -> str:
                    return re.sub(r'\x1B\[[0-?]*[ -/]*[@-~]', '', s or '').strip()
                out, err = _strip(proc.stdout), _strip(proc.stderr)
                if proc.returncode == 0:
                    note = None
                    if 'not found' in (out + ' ' + err).lower() or 'no such model' in (out + ' ' + err).lower() or 'does not exist' in (out + ' ' + err).lower():
                        note = 'already missing'
                    payload = {"status": "deleted", "source": "cli"}
                    if note:
                        payload["note"] = note
                    return jsonify(payload)
                # Non-zero: treat specific missing cases as success as well
                combined = (out + ' ' + err).lower()
                if 'not found' in combined or 'no such model' in combined or 'does not exist' in combined:
                    return jsonify({"status": "deleted", "source": "cli", "note": "already missing"})
                raise RuntimeError(err or out or 'ollama rm failed')
            except Exception as exc:
                raise PlaygroundError(f"Ollama /delete fallback failed: {exc}", status=503)
        raise PlaygroundError(f"Ollama /delete failed: {http_exc}", status=503)
    except Exception as exc:  # pragma: no cover
        raise PlaygroundError(f"Ollama /delete failed: {exc}", status=503)


@api.route("/voices_catalog", methods=["GET"])
def voices_catalog_endpoint():
    engine_id = request.args.get("engine")
    engine, available = resolve_engine(engine_id, allow_unavailable=True)

    payload_factory = engine.get("fetch_voices")
    voice_payload = payload_factory() if callable(payload_factory) else {"engine": engine["id"], "available": available, "voices": [], "accentGroups": [], "count": 0}

    engines_meta = [serialise_engine_meta(e) for e in ENGINE_REGISTRY.values()]

    # Ensure filters exist even if engine doesn't provide them
    filters = voice_payload.get("filters") or {}
    voices = voice_payload.get("voices", [])
    if not filters:
        from collections import Counter
        genders = Counter((v.get("gender") or "unknown") for v in voices if isinstance(v, dict))
        locales = Counter((v.get("locale") or "misc") for v in voices if isinstance(v, dict))
        filters = {
            "genders": [
                {"id": k, "label": ("Female" if k == "female" else "Male" if k == "male" else "Unknown"), "count": c}
                for k, c in sorted(genders.items())
            ],
            "locales": [
                {"id": k, "label": (k.upper() if k != "misc" else "Miscellaneous"), "count": c}
                for k, c in sorted(locales.items())
            ],
            "accents": voice_payload.get("accentGroups") or voice_payload.get("groups") or [],
        }
    # Add normalized accent families to filters
    try:
        filters = dict(filters)
        filters["accentFamilies"] = build_accent_families(voices)
    except Exception:
        pass

    response = {
        "engine": engine["id"],
        "available": available and bool(voice_payload.get("available", True)),
        "voices": voice_payload.get("voices", []),
        "count": voice_payload.get("count", len(voice_payload.get("voices", []))),
        "filters": {
            **filters,
            "engines": engines_meta,
        },
    }
    return jsonify(response)


@api.route("/voices/preview", methods=["POST"])
def create_voice_preview_endpoint():
    """Generate or return a cached short preview clip for a voice.

    Request JSON: { engine: string, voiceId: string, language?: string, force?: boolean, ...engine specific }
    Returns: { preview_url: string }
    """
    payload = parse_json_request()
    engine_id = str(payload.get("engine") or "kokoro").strip().lower()
    voice_id = str(payload.get("voiceId") or payload.get("voice") or "").strip()
    if not voice_id:
        raise PlaygroundError("Field 'voiceId' is required.", status=400)
    raw_language = payload.get("language")
    language = str(raw_language).strip() if isinstance(raw_language, str) and raw_language.strip() else None
    force = bool(payload.get("force"))

    engine, available = resolve_engine(engine_id)
    if not available:
        raise PlaygroundError(f"TTS engine '{engine_id}' is not available.", status=503)

    generator = PREVIEW_GENERATORS.get(engine["id"])
    if generator is None:
        raise PlaygroundError(f"Preview generation is not supported for engine '{engine['id']}'.", status=400)

    options = {
        key: value
        for key, value in payload.items()
        if key not in {"engine", "voiceId", "voice", "force", "language"}
    }
    reported_language = language
    if not reported_language:
        lang_option = options.get("language")
        if isinstance(lang_option, str) and lang_option.strip():
            reported_language = lang_option.strip()

    path = generator(voice_id, language, force=force, **options)
    rel = path.relative_to(OUTPUT_DIR)
    return jsonify({
        "engine": engine["id"],
        "voice": voice_id,
        "language": reported_language,
        "preview_url": f"/audio/{rel.as_posix()}",
    })


@api.route("/xtts/custom_voice", methods=["POST"])
def xtts_custom_voice_endpoint():
    """Create a custom XTTS voice from an uploaded file or a YouTube URL segment.

    Accepts either:
      - multipart/form-data with fields: label?, file, start?, end?
      - application/json: { source: 'youtube', url: string, start?: string|number, end?: string|number, label?: string }

    Saves a normalised mono 24kHz WAV under XTTS_VOICE_DIR and returns the created voice id and preview URL.
    """
    # Ensure XTTS service is present
    if not XTTS_SERVICE_DIR.exists() or not XTTS_PYTHON.exists():
        raise PlaygroundError("XTTS engine is not available on this host.", status=503)

    XTTS_VOICE_DIR.mkdir(parents=True, exist_ok=True)

    content_type = (request.content_type or "").lower()
    label: Optional[str] = None
    start_seconds: Optional[float] = None
    end_seconds: Optional[float] = None
    temp_src: Optional[Path] = None
    try:
        if content_type.startswith("multipart/form-data"):
            file = request.files.get("file")
            if not file or file.filename is None:
                raise PlaygroundError("No file uploaded.", status=400)
            raw_label = request.form.get("label")
            if raw_label:
                label = str(raw_label).strip()
            if request.form.get("start"):
                start_seconds = _parse_timecode(request.form.get("start"))
            if request.form.get("end"):
                end_seconds = _parse_timecode(request.form.get("end"))
            # Save to a temp file first
            suffix = Path(file.filename).suffix or ".wav"
            temp_src = Path(OUTPUT_DIR) / f"upload-{uuid.uuid4().hex}{suffix}"
            file.save(str(temp_src))
        else:
            payload = parse_json_request()
            source = str(payload.get("source") or "").strip().lower()
            label = (str(payload.get("label") or "").strip() or None)
            start_seconds = _parse_timecode(payload.get("start"))
            end_seconds = _parse_timecode(payload.get("end"))
            if source != "youtube":
                raise PlaygroundError("Provide multipart 'file' upload or JSON { source: 'youtube', url }.", status=400)
            url = str(payload.get("url") or "").strip()
            if not url:
                raise PlaygroundError("Field 'url' is required for YouTube source.", status=400)
            if not _have_tool("yt-dlp"):
                raise PlaygroundError("yt-dlp is required for YouTube imports. Install 'yt-dlp' and try again.", status=503)
            # Download best audio to temp (let yt-dlp decide extension)
            temp_base = OUTPUT_DIR / f"yt-{uuid.uuid4().hex}"
            out_tmpl = f"{temp_base}.%(ext)s"
            cmd = ["yt-dlp", "-f", "bestaudio/best", "--sleep-requests", "1", "--retry-sleep", "2", "--retries", "3", "-o", out_tmpl]
            # Use cookies if available to reduce 429/age gating
            try:
                if YT_DLP_COOKIES_PATH.exists():
                    cmd += ["--cookies", str(YT_DLP_COOKIES_PATH)]
            except Exception:
                pass
            if YT_DLP_EXTRACTOR_ARGS.strip():
                cmd += ["--extractor-args", YT_DLP_EXTRACTOR_ARGS.strip()]
            cmd.append(url)
            try:
                subprocess.run(cmd, check=True)
            except subprocess.CalledProcessError as exc:
                raise PlaygroundError(f"yt-dlp failed: {exc}", status=500)
            # Resolve the actual downloaded filename
            candidates = list(OUTPUT_DIR.glob(f"{temp_base.name}.*"))
            if not candidates:
                raise PlaygroundError("yt-dlp did not produce an output file.", status=500)
            # Prefer typical audio extensions
            pref_order = [".m4a", ".mp3", ".webm", ".opus", ".ogg"]
            best = None
            for ext in pref_order:
                for c in candidates:
                    if c.suffix.lower() == ext:
                        best = c
                        break
                if best:
                    break
            temp_src = (OUTPUT_DIR / candidates[0]) if best is None else (OUTPUT_DIR / best)

        # Determine output slug/filename
        if not label and temp_src is not None:
            label = Path(temp_src).stem
        slug = _slugify_voice_id(label or f"voice-{uuid.uuid4().hex[:6]}")
        out_path = _unique_xtts_filename(slug, ".wav")

        # Normalise and optionally trim
        _ffmpeg_normalise_to_wav(temp_src, out_path, start=start_seconds, end=end_seconds)

        # Validate duration
        dur = _probe_duration_seconds(out_path)
        if dur < XTTS_MIN_REF_SECONDS or dur > XTTS_MAX_REF_SECONDS:
            try:
                out_path.unlink()
            except OSError:
                pass
            raise PlaygroundError(
                f"Reference must be between {int(XTTS_MIN_REF_SECONDS)} and {int(XTTS_MAX_REF_SECONDS)} seconds (got {dur:.1f}s).",
                status=400,
            )

        voice_id = _slugify_voice_id(out_path.stem)
        # Write sidecar with source metadata
        sidecar_path = out_path.with_suffix('.meta.json')
        try:
            source_meta: Dict[str, Any]
            if content_type.startswith("multipart/form-data"):
                up = request.files.get('file') if 'file' in request.files else None
                src_name = (up.filename if up and getattr(up, 'filename', None) else None)
                source_meta = {
                    'type': 'upload',
                    'filename': src_name or (temp_src.name if temp_src else None),
                    'start': start_seconds,
                    'end': end_seconds,
                }
            else:
                yt_title = None
                try:
                    proc = subprocess.run(["yt-dlp", "-e", url], capture_output=True, text=True, timeout=60)
                    if proc.returncode == 0:
                        yt_title = (proc.stdout or '').strip()
                except Exception:
                    yt_title = None
                source_meta = {
                    'type': 'youtube',
                    'url': url,
                    'title': yt_title,
                    'start': start_seconds,
                    'end': end_seconds,
                }
            sidecar_payload: Dict[str, Any] = {
                'gender': 'unknown',
                'tags': [],
                'notes': (label or None),
                'accent': {'id': 'custom', 'label': 'Custom Voice', 'flag': '🎙️'},
                'source': source_meta,
                'createdAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            }
            with sidecar_path.open('w', encoding='utf-8') as f:
                json.dump(sidecar_payload, f, indent=2, ensure_ascii=False)
        except Exception:
            pass
        # Generate preview (best-effort)
        try:
            _get_or_create_xtts_preview(voice_id, language=None, force=True)
        except Exception:
            pass

        rel_preview = _find_cached_preview("xtts", voice_id)
        return jsonify(
            {
                "status": "created",
                "engine": "xtts",
                "voice": {
                    "id": voice_id,
                    "label": out_path.stem.replace("_", " ").title(),
                    "path": str(out_path),
                    "preview_url": rel_preview,
                },
            }
        )
    finally:
        # Clean up temp source files
        if temp_src and temp_src.exists():
            try:
                temp_src.unlink()
            except OSError:
                pass


def _xtts_sidecar_path_for_id(voice_id: str) -> Tuple[Path, Path]:
    vid, path = _resolve_xtts_voice_path(voice_id)
    return path, path.with_suffix('.meta.json')


@api.route("/xtts/custom_voice/<voice_id>", methods=["GET", "PATCH", "DELETE"])
def xtts_custom_voice_item_endpoint(voice_id: str):
    """Manage a single XTTS custom voice.

    GET    → return metadata and resolved path
    PATCH  → update sidecar fields: language, gender, accent{id,label,flag}, tags[], notes
    DELETE → remove audio file and sidecar
    """
    try:
        voice_path, sidecar_path = _xtts_sidecar_path_for_id(voice_id)
    except PlaygroundError as exc:
        raise

    if request.method == 'GET':
        meta: Dict[str, Any] = {}
        if sidecar_path.exists():
            try:
                with sidecar_path.open('r', encoding='utf-8') as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        meta = data
            except Exception:
                meta = {}
        return jsonify({
            'id': voice_id,
            'label': voice_path.stem.replace('_', ' ').title(),
            'path': str(voice_path),
            'meta': meta,
        })

    if request.method == 'DELETE':
        # Safety: ensure file is under XTTS_VOICE_DIR
        try:
            voice_path.resolve().relative_to(XTTS_VOICE_DIR.resolve())
        except Exception:
            raise PlaygroundError('Refusing to delete file outside voices directory.', status=400)
        removed = []
        try:
            voice_path.unlink()
            removed.append(str(voice_path))
        except OSError:
            pass
        try:
            if sidecar_path.exists():
                sidecar_path.unlink()
                removed.append(str(sidecar_path))
        except OSError:
            pass
        return jsonify({'status': 'deleted', 'removed': removed})

    # PATCH
    payload = parse_json_request()
    sidecar: Dict[str, Any] = {}
    if sidecar_path.exists():
        try:
            with sidecar_path.open('r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, dict):
                    sidecar = data
        except Exception:
            sidecar = {}

    # Allowed fields
    def _str(v: Any) -> Optional[str]:
        return str(v).strip() if isinstance(v, str) and str(v).strip() else None

    lang = _str(payload.get('language'))
    if lang is not None:
        sidecar['language'] = lang.lower()

    gender = _str(payload.get('gender'))
    if gender is not None:
        g = gender.lower()
        if g not in {'female', 'male', 'unknown'}:
            raise PlaygroundError("gender must be 'female', 'male', or 'unknown'", status=400)
        sidecar['gender'] = g

    if 'tags' in payload:
        tags_val = payload.get('tags')
        if tags_val is None:
            sidecar.pop('tags', None)
        elif isinstance(tags_val, list):
            sidecar['tags'] = [str(t) for t in tags_val if str(t).strip()]
        else:
            raise PlaygroundError('tags must be an array of strings', status=400)

    notes = payload.get('notes')
    if notes is None:
        pass
    elif isinstance(notes, str):
        sidecar['notes'] = notes.strip()
    else:
        raise PlaygroundError('notes must be a string', status=400)

    if 'accent' in payload:
        acc = payload.get('accent')
        if acc is None:
            sidecar.pop('accent', None)
        elif isinstance(acc, dict):
            sid = _str(acc.get('id')) or 'custom'
            slabel = _str(acc.get('label')) or 'Custom Voice'
            sflag = _str(acc.get('flag')) or '🎙️'
            sidecar['accent'] = {'id': sid, 'label': slabel, 'flag': sflag}
        else:
            raise PlaygroundError('accent must be an object {id,label,flag}', status=400)

    sidecar['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    sidecar_path.parent.mkdir(parents=True, exist_ok=True)
    with sidecar_path.open('w', encoding='utf-8') as f:
        json.dump(sidecar, f, indent=2, ensure_ascii=False)

    return jsonify({'status': 'updated', 'id': voice_id, 'meta': sidecar})


@api.route("/chattts/presets", methods=["POST"])
def chattts_create_preset_endpoint():
    if not chattts_is_available():
        raise PlaygroundError("ChatTTS engine is not available.", status=503)

    payload = parse_json_request()
    label = str(payload.get("label", "")).strip()
    if not label:
        raise PlaygroundError("Field 'label' is required.", status=400)

    speaker_raw = payload.get("speaker")
    if not isinstance(speaker_raw, str) or not speaker_raw.strip():
        raise PlaygroundError("Field 'speaker' is required.", status=400)
    speaker_value = speaker_raw.strip()

    notes_value: Optional[str] = None
    notes_raw = payload.get("notes")
    if isinstance(notes_raw, str):
        candidate = notes_raw.strip()
        if candidate:
            notes_value = candidate

    seed_value: Optional[int] = None
    if "seed" in payload and payload["seed"] not in (None, ""):
        try:
            seed_value = int(str(payload["seed"]).strip())
        except (TypeError, ValueError) as exc:
            raise PlaygroundError("Field 'seed' must be an integer.", status=400) from exc

    requested_id = payload.get("id")
    preset_id = None
    if isinstance(requested_id, str) and requested_id.strip():
        preset_id = _slugify_chattts_preset_id(requested_id)
        if not preset_id:
            raise PlaygroundError("Field 'id' must contain alphanumeric characters.", status=400)
    else:
        preset_id = _slugify_chattts_preset_id(label)

    if not preset_id:
        preset_id = f"preset_{int(time.time())}"

    directory = CHATTT_PRESET_DIR
    directory.mkdir(parents=True, exist_ok=True)

    candidate_id = preset_id
    preset_path = directory / f"{candidate_id}.json"
    counter = 1
    if isinstance(requested_id, str) and requested_id.strip():
        if preset_path.exists():
            raise PlaygroundError(f"ChatTTS preset '{candidate_id}' already exists.", status=409)
    else:
        while preset_path.exists():
            counter += 1
            candidate_id = f"{preset_id}_{counter}"
            preset_path = directory / f"{candidate_id}.json"

    preset_id = candidate_id

    preset_data: Dict[str, Any] = {
        "id": preset_id,
        "label": label,
        "speaker": speaker_value,
    }
    if notes_value is not None:
        preset_data["notes"] = notes_value
    if seed_value is not None:
        preset_data["seed"] = seed_value

    try:
        with preset_path.open("w", encoding="utf-8") as preset_file:
            json.dump(preset_data, preset_file, ensure_ascii=True, indent=2)
            preset_file.write("\n")
    except OSError as exc:
        raise PlaygroundError(f"Failed to write ChatTTS preset: {exc}", status=500) from exc

    presets = chattts_list_presets()
    created = next((item for item in presets if item.get("id") == preset_id), preset_data)

    return make_response(jsonify({"preset": created, "presets": presets}), 201)


@api.route("/random_text", methods=["GET"])
def random_text_endpoint():
    category = (request.args.get("category", "any") or "any").lower()
    if category not in RANDOM_SNIPPETS:
        category = "any"

    snippets = RANDOM_SNIPPETS.get(category, RANDOM_SNIPPETS["any"])
    ollama_text = call_ollama(category)

    if ollama_text:
        source = "ollama"
        text = ollama_text
    else:
        import random

        text = random.choice(snippets)
        source = "local"

    return jsonify(
        {
            "text": text,
            "source": source,
            "category": category,
            "categories": RANDOM_CATEGORIES,
        }
    )


@api.route("/ollama_models", methods=["GET"])
def ollama_models_endpoint():
    info = list_ollama_models()
    status = 200 if info.get("models") else 503
    payload = {
        "models": info.get("models", []),
        "url": info.get("url"),
        "available": bool(info.get("models")),
    }
    if info.get("error"):
        payload["error"] = info["error"]
    return make_response(jsonify(payload), status)


def parse_json_request() -> Dict[str, Any]:
    if request.is_json:
        data = request.get_json()
    else:
        try:
            data = json.loads(request.data.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise PlaygroundError(f"Invalid JSON payload: {exc}") from exc
    if not isinstance(data, dict):
        raise PlaygroundError("JSON payload must be an object.")
    return data


@api.route("/favorites", methods=["GET", "POST"])
def favorites_collection_endpoint():
    if request.method == "GET":
        _check_api_key()
        items = _favorites_store.list()
        engine_filter = request.args.get("engine")
        tag_filter = request.args.get("tag")
        if engine_filter:
            items = [p for p in items if p.get("engine") == engine_filter]
        if tag_filter:
            items = [p for p in items if isinstance(p.get("tags"), list) and tag_filter in p.get("tags")]
        return jsonify({"profiles": items, "count": len(items)})
    # POST create
    _check_api_key()
    payload = parse_json_request()
    try:
        created = _favorites_store.create(payload)
    except ValueError as exc:
        raise PlaygroundError(str(exc), status=400)
    return jsonify(created)


@api.route("/favorites/<profile_id>", methods=["GET", "PATCH", "DELETE"])
def favorites_item_endpoint(profile_id: str):
    _check_api_key()
    if request.method == "GET":
        item = _favorites_store.get(profile_id)
        if not item:
            raise PlaygroundError("Not found", status=404)
        return jsonify(item)
    if request.method == "PATCH":
        payload = parse_json_request()
        updated = _favorites_store.update(profile_id, payload)
        if not updated:
            raise PlaygroundError("Not found", status=404)
        return jsonify(updated)
    ok = _favorites_store.delete(profile_id)
    if not ok:
        raise PlaygroundError("Not found", status=404)
    return jsonify({"ok": True})


@api.route("/favorites/export", methods=["GET"])
def favorites_export_endpoint():
    _check_api_key()
    return jsonify(_favorites_store.export())


@api.route("/favorites/import", methods=["POST"])
def favorites_import_endpoint():
    _check_api_key()
    payload = parse_json_request()
    mode = str(payload.get("mode") or "merge").lower()
    if mode not in {"merge", "replace"}:
        mode = "merge"
    count = _favorites_store.import_(payload, mode=mode)
    return jsonify({"imported": count, "mode": mode})


def validate_synthesis_payload(payload: Dict[str, Any], *, require_voice: bool = True) -> Dict[str, Any]:
    text = str(payload.get("text", "")).strip()
    voice = payload.get("voice")
    if not text:
        raise PlaygroundError("Field 'text' is required.", status=400)
    if require_voice and not voice:
        raise PlaygroundError("Field 'voice' is required.", status=400)

    try:
        speed = float(payload.get("speed", 1.0))
    except (TypeError, ValueError) as exc:
        raise PlaygroundError("Field 'speed' must be numeric.") from exc

    language = str(payload.get("language", "en-us")).lower()
    trim_raw = payload.get("trimSilence", payload.get("trim_silence", True))
    trim = bool(trim_raw)

    return {
        "text": text,
        "voice": voice,
        "speed": speed,
        "language": language,
        "trim_silence": trim,
    }



DEFAULT_TTS_ENGINE = "kokoro"


def _engine_not_ready(engine_id: str) -> None:
    raise PlaygroundError(f"TTS engine '{engine_id}' is not yet connected to the playground.", status=501)


def engine_is_available(engine: Dict[str, Any]) -> bool:
    checker = engine.get("availability")
    try:
        return bool(checker()) if callable(checker) else bool(checker)
    except Exception:
        return False


def resolve_engine(engine_id: Optional[str], *, allow_unavailable: bool = False) -> Tuple[Dict[str, Any], bool]:
    key = (engine_id or DEFAULT_TTS_ENGINE).lower()
    engine = ENGINE_REGISTRY.get(key)
    if not engine:
        raise PlaygroundError(f"Unknown TTS engine '{key}'.", status=400)
    available = engine_is_available(engine)
    if not available and not allow_unavailable:
        raise PlaygroundError(f"TTS engine '{key}' is not available.", status=503)
    return engine, available


def serialise_engine_meta(engine: Dict[str, Any]) -> Dict[str, Any]:
    available = engine_is_available(engine)
    return {
        "id": engine["id"],
        "label": engine.get("label", engine["id"].title()),
        "description": engine.get("description"),
        "available": available,
        "requiresVoice": engine.get("requires_voice", True),
        "supports": engine.get("supports", {}),
        "defaults": dict(engine.get("defaults", {})),
        "status": engine.get("status", "ready" if available else "pending"),
    }


def _kokoro_prepare_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    return validate_synthesis_payload(payload, require_voice=True)


def _kokoro_synthesise(data: Dict[str, Any]) -> Dict[str, Any]:
    return synthesise_audio_clip(**data)


ENGINE_REGISTRY: Dict[str, Dict[str, Any]] = {
    "kokoro": {
        "id": "kokoro",
        "label": "Kokoro (ONNX)",
        "description": "Bundled Kokoro voices running locally via ONNX.",
        "availability": lambda: MODEL_PATH.exists() and VOICES_PATH.exists(),
        "requires_voice": True,
        "defaults": {"voice": "af_heart", "language": "en-us"},
        "supports": {"audition": True, "cloning": False},
        "prepare": _kokoro_prepare_payload,
        "synthesise": _kokoro_synthesise,
        "fetch_voices": build_kokoro_voice_payload,
    },
    "xtts": {
        "id": "xtts",
        "label": "XTTS v2",
        "description": "Coqui XTTS voice cloning (local CLI).",
        "availability": xtts_is_available,
        "requires_voice": True,
        "defaults": {},
        "supports": {"cloning": True},
        "prepare": _xtts_prepare_payload,
        "synthesise": _xtts_synthesise,
        "fetch_voices": build_xtts_voice_payload,
    },
    "openvoice": {
        "id": "openvoice",
        "label": "OpenVoice v2",
        "description": "OpenVoice instant voice cloning (tone-color transfer).",
        "availability": openvoice_is_available,
        "requires_voice": True,
        "defaults": {"language": "English", "style": "default"},
        "supports": {"cloning": True, "styles": True},
        "prepare": _openvoice_prepare_payload,
        "synthesise": _openvoice_synthesise,
        "fetch_voices": build_openvoice_voice_payload,
    },
    "chattts": {
        "id": "chattts",
        "label": "ChatTTS",
        "description": "ChatTTS dialogue model (random speaker).",
        "availability": chattts_is_available,
        "requires_voice": False,
        "supports": {"cloning": False},
        "prepare": _chattts_prepare_payload,
        "synthesise": _chattts_synthesise,
        "fetch_voices": build_chattts_voice_payload,
    },
}


@api.route("/synthesise", methods=["POST"])
@api.route("/synthesize", methods=["POST"])
def synthesise_endpoint():
    raw_payload = parse_json_request()
    # Optional: resolve profileId/profileSlug from the Favorites store
    profile_id = raw_payload.get("profileId") or raw_payload.get("profile_id") or raw_payload.get("favoriteId") or raw_payload.get("favorite_id")
    profile_slug = raw_payload.get("profileSlug") or raw_payload.get("profile_slug") or raw_payload.get("favoriteSlug") or raw_payload.get("favorite_slug")
    profile = None
    if profile_id:
        profile = _favorites_store.get(str(profile_id))
    elif profile_slug:
        profile = _favorites_store.get_by_slug(str(profile_slug))
    if profile:
        raw_payload.setdefault("engine", profile.get("engine"))
        raw_payload.setdefault("voice", profile.get("voiceId"))
        if profile.get("language"):
            raw_payload.setdefault("language", profile.get("language"))
        if profile.get("speed") is not None:
            raw_payload.setdefault("speed", profile.get("speed"))
        if profile.get("trimSilence") is not None:
            raw_payload.setdefault("trimSilence", profile.get("trimSilence"))
        if profile.get("style"):
            raw_payload.setdefault("style", profile.get("style"))
        if profile.get("seed") is not None:
            raw_payload.setdefault("seed", profile.get("seed"))
        if profile.get("serverUrl"):
            raw_payload.setdefault("serverUrl", profile.get("serverUrl"))
    engine, _ = resolve_engine(raw_payload.get("engine"))

    prepare = engine.get("prepare")
    prepared_payload = prepare(raw_payload) if callable(prepare) else raw_payload

    handler = engine.get("synthesise")
    if not callable(handler):
        _engine_not_ready(engine["id"])

    result = handler(prepared_payload)
    if isinstance(result, dict):
        result.setdefault("engine", engine["id"])
    return jsonify(result)


def _load_engine_voice_catalog(engine: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    fetcher = engine.get("fetch_voices")
    if not callable(fetcher):
        return {}
    try:
        data = fetcher()
    except Exception:
        return {}
    voices = data.get("voices") if isinstance(data, dict) else None
    if not isinstance(voices, list):
        return {}
    catalogue: Dict[str, Dict[str, Any]] = {}
    for entry in voices:
        if isinstance(entry, dict) and entry.get("id"):
            catalogue[str(entry["id"])] = entry
    return catalogue


def _build_clip_request(
    base_payload: Dict[str, Any],
    voice_id: str,
    overrides: Optional[Dict[str, Any]] = None,
    *,
    text: Optional[str] = None,
) -> Dict[str, Any]:
    overrides = overrides or {}
    clip_payload: Dict[str, Any] = {
        "text": text if text is not None else base_payload["text"],
        "voice": voice_id,
        "language": overrides.get("language", base_payload["language"]),
        "speed": overrides.get("speed", base_payload["speed"]),
        "trimSilence": overrides.get("trimSilence", overrides.get("trim_silence", base_payload["trim_silence"])),
    }
    clip_payload["trimSilence"] = bool(clip_payload["trimSilence"])
    clip_payload["trim_silence"] = clip_payload["trimSilence"]
    for key, value in overrides.items():
        if key in {"language", "speed", "trimSilence", "trim_silence"}:
            continue
        clip_payload[key] = value
    clip_payload.setdefault("format", overrides.get("format", "wav"))
    return clip_payload


def _synthesise_clip_via_engine(engine: Dict[str, Any], clip_payload: Dict[str, Any]) -> Tuple[np.ndarray, int]:
    prepare = engine.get("prepare")
    handler = engine.get("synthesise")
    if not callable(handler):
        raise PlaygroundError(f"TTS engine '{engine['id']}' does not support synthesis.", status=503)

    prepared_payload = prepare(clip_payload) if callable(prepare) else clip_payload

    result = handler(prepared_payload)
    if not isinstance(result, dict):
        raise PlaygroundError("Unexpected response from TTS engine.", status=500)

    audio_path = None
    for key in ("path", "audio_path", "audioUrl", "audio_url"):
        candidate = result.get(key)
        if candidate:
            audio_path = str(candidate)
            break
    if not audio_path:
        raise PlaygroundError("TTS engine response missing audio path.", status=500)

    file_path = Path(audio_path)
    if audio_path.startswith("/audio/"):
        file_path = OUTPUT_DIR / audio_path.split("/")[-1]
    elif not file_path.is_absolute():
        file_path = OUTPUT_DIR / file_path.name

    if not file_path.exists():
        raise PlaygroundError(f"TTS audio not found at {file_path}", status=500)

    audio, sample_rate = sf.read(str(file_path), dtype="float32")
    if audio.ndim > 1:
        audio = np.mean(audio, axis=1)
    return audio.astype(np.float32), int(sample_rate)


def render_announcer_segments(
    engine: Dict[str, Any],
    announcer_cfg: Dict[str, Any],
    voice_id: str,
    voice_meta: Optional[Dict[str, Any]],
    base_payload: Dict[str, Any],
    voice_overrides: Dict[str, Dict[str, Any]],
) -> Tuple[List[np.ndarray], Optional[int]]:
    segments: List[np.ndarray] = []
    resolved_voice = announcer_cfg.get("voice") or voice_id
    template = (announcer_cfg.get("template") or "Now auditioning {voice_label}").strip()
    gap_seconds = float(announcer_cfg.get("gapSeconds", announcer_cfg.get("gap_seconds", 0.5)))

    voice_label = None
    if voice_meta and isinstance(voice_meta, dict):
        voice_label = voice_meta.get("label")
    if not voice_label:
        voice_label = voice_id

    try:
        announcer_text = template.format(voice=voice_id, voice_label=voice_label)
    except Exception:
        announcer_text = template

    overrides: Dict[str, Any] = {}
    base_override = voice_overrides.get(resolved_voice)
    if isinstance(base_override, dict):
        overrides.update(base_override)
    ann_override = announcer_cfg.get("overrides")
    if isinstance(ann_override, dict):
        overrides.update(ann_override)

    language = overrides.pop("language", announcer_cfg.get("language", base_payload["language"]))
    speed = float(overrides.pop("speed", announcer_cfg.get("speed", base_payload["speed"])))
    trim_value = overrides.pop("trimSilence", overrides.pop("trim_silence", announcer_cfg.get("trim", announcer_cfg.get("trim_silence", base_payload["trim_silence"]))))

    clip_payload = _build_clip_request(
        {
            **base_payload,
            "language": language,
            "speed": speed,
            "trim_silence": bool(trim_value),
        },
        resolved_voice,
        overrides,
        text=announcer_text,
    )

    ann_audio, ann_sr = _synthesise_clip_via_engine(engine, clip_payload)
    segments.append(ann_audio)
    if gap_seconds > 0 and ann_sr:
        gap = np.zeros(int(float(ann_sr) * gap_seconds), dtype=np.float32)
        segments.append(gap)
    return segments, ann_sr


@api.route("/audition", methods=["POST"])
def audition_endpoint():
    payload = parse_json_request()
    engine, _ = resolve_engine(payload.get("engine"))

    base_payload = validate_synthesis_payload(payload, require_voice=False)

    voices = payload.get("voices") or payload.get("voice") or []
    if isinstance(voices, str):
        voices = [voices]
    if not isinstance(voices, list):
        raise PlaygroundError("Field 'voices' must be a list of voice ids.")
    voice_ids = [str(v) for v in voices if v]
    if len(voice_ids) < 2:
        raise PlaygroundError("Provide at least two voices to build an audition.", status=400)

    gap_seconds = float(payload.get("gapSeconds", payload.get("gap_seconds", 1.0)))
    announcer_cfg = (payload.get("announcer") or {}) if isinstance(payload.get("announcer"), dict) else {}
    announcer_enabled = bool(announcer_cfg.get("enabled"))
    voice_overrides_raw = payload.get("voice_overrides") or {}
    voice_overrides = voice_overrides_raw if isinstance(voice_overrides_raw, dict) else {}

    catalogue = _load_engine_voice_catalog(engine)
    sample_rate: Optional[int] = None
    clips: List[np.ndarray] = []

    for voice_id in voice_ids:
        segments: List[np.ndarray] = []
        overrides = voice_overrides.get(voice_id)
        if not isinstance(overrides, dict):
            overrides = {}

        if announcer_enabled:
            announcer_segments, ann_sr = render_announcer_segments(
                engine,
                announcer_cfg,
                voice_id,
                catalogue.get(voice_id),
                base_payload,
                voice_overrides,
            )
            segments.extend(announcer_segments)
            if ann_sr is not None:
                if sample_rate is None:
                    sample_rate = ann_sr
                elif sample_rate != ann_sr:
                    raise PlaygroundError("Sample rate mismatch between announcer segments.", status=500)

        clip_payload = _build_clip_request(base_payload, voice_id, overrides)
        audio, sr = _synthesise_clip_via_engine(engine, clip_payload)
        if sample_rate is None:
            sample_rate = sr
        elif sample_rate != sr:
            raise PlaygroundError("Sample rate mismatch between voices.", status=500)
        segments.append(audio)
        clips.append(np.concatenate(segments) if len(segments) > 1 else segments[0])

    assert sample_rate is not None

    combined = concatenate_clips(clips, sample_rate, gap_seconds=gap_seconds)
    filename = f"{int(time.time())}-{uuid.uuid4().hex[:10]}-audition.wav"
    output_path = OUTPUT_DIR / filename
    sf.write(output_path, combined, sample_rate)

    return jsonify(
        {
            "id": filename,
            "engine": engine["id"],
            "voice": "audition",
            "voices": voice_ids,
            "announcer": {
                "enabled": announcer_enabled,
                "voice": announcer_cfg.get("voice"),
                "template": announcer_cfg.get("template"),
            },
            "path": f"/audio/{filename}",
            "filename": filename,
            "sample_rate": sample_rate,
        }
    )


blueprint_prefix = f"/{API_PREFIX}" if API_PREFIX else ""
app.register_blueprint(api, url_prefix=blueprint_prefix or None)

_legacy_routes = [
    ("/meta", meta_endpoint, ["GET"]),
    ("/voices", voices_endpoint, ["GET"]),
    ("/voices_grouped", voices_grouped_endpoint, ["GET"]),
    ("/voices_catalog", voices_catalog_endpoint, ["GET"]),
    ("/ollama/tags", ollama_tags_proxy, ["GET"]),
    ("/ollama/generate", ollama_generate_proxy, ["POST"]),
    ("/ollama/chat", ollama_chat_proxy, ["POST"]),
    ("/ollama/pull", ollama_pull_proxy, ["POST"]),
    ("/ollama/ps", ollama_ps_proxy, ["GET"]),
    ("/ollama/show", ollama_show_proxy, ["GET", "POST"]),
    ("/ollama/delete", ollama_delete_proxy, ["GET", "POST"]),
    # Draw Things HTTP API proxies (A1111-compatible)
    ("/drawthings/models", drawthings_models_proxy, ["GET"]),
    ("/drawthings/samplers", drawthings_samplers_proxy, ["GET"]),
    ("/drawthings/txt2img", drawthings_txt2img_proxy, ["POST"]),
    ("/drawthings/img2img", drawthings_img2img_proxy, ["POST"]),
    ("/random_text", random_text_endpoint, ["GET"]),
    ("/ollama_models", ollama_models_endpoint, ["GET"]),
    ("/synthesise", synthesise_endpoint, ["POST"]),
    ("/synthesize", synthesise_endpoint, ["POST"]),
    ("/audition", audition_endpoint, ["POST"]),
]

for rule, view_func, methods in _legacy_routes:
    endpoint_name = f"legacy_{view_func.__name__}_{rule.strip('/').replace('/', '_') or 'root'}"
    if endpoint_name not in app.view_functions:
        app.add_url_rule(rule, endpoint=endpoint_name, view_func=view_func, methods=methods)


@app.route("/audio/openvoice/<path:filename>", methods=["GET"])
def openvoice_reference_endpoint(filename: str):
    root = OPENVOICE_REFERENCE_DIR.resolve()
    candidate = (root / filename).resolve()
    try:
        relative = candidate.relative_to(root)
    except ValueError:
        abort(404)
    if not candidate.is_file():
        abort(404)
    return send_from_directory(root, str(relative), as_attachment=False)


@app.route("/audio/<path:filename>", methods=["GET"])
def audio_endpoint(filename: str):
    return send_from_directory(OUTPUT_DIR, filename, as_attachment=False)


@app.route("/image/drawthings/<path:filename>", methods=["GET"])
def drawthings_image_endpoint(filename: str):
    root = DRAWTHINGS_IMAGE_DIR.resolve()
    candidate = (root / filename).resolve()
    try:
        relative = candidate.relative_to(root)
    except ValueError:
        abort(404)
    if not candidate.is_file():
        abort(404)
    return send_from_directory(root, str(relative), as_attachment=False)


@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({"status": "ok"})


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def spa_handler(path: str):
    if (API_PREFIX and (path == API_PREFIX or path.startswith(f"{API_PREFIX}/"))) or path.startswith("audio/"):
        return make_response(jsonify({"error": "Not found"}), 404)

    if FRONTEND_DIST.exists():
        requested = (FRONTEND_DIST / path).resolve()
        try:
            relative = requested.relative_to(FRONTEND_DIST)
        except ValueError:
            relative = Path("index.html")

        if requested.is_file():
            return send_from_directory(FRONTEND_DIST, str(relative))

        index_path = FRONTEND_DIST / "index.html"
        if index_path.is_file():
            return send_from_directory(FRONTEND_DIST, "index.html")

    return jsonify({"status": "ok"})


def main() -> None:
    log = lambda msg: print(f"[Kokoro SPA Backend] {msg}")  # noqa: E731
    log(f"Model path: {MODEL_PATH}")
    log(f"Voices path: {VOICES_PATH}")
    log(f"Output directory: {OUTPUT_DIR}")
    log(f"Frontend bundle: {FRONTEND_DIST}")
    app.run(host=BACKEND_HOST, port=BACKEND_PORT, debug=False)


if __name__ == "__main__":
    main()
