from __future__ import annotations

import json
import os
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

import numpy as np
import soundfile as sf
from flask import Blueprint, Flask, jsonify, make_response, request, send_from_directory
from flask_cors import CORS

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

FRONTEND_DIST = Path(os.environ.get("FRONTEND_DIST", APP_ROOT / "frontend" / "dist")).resolve()

MODEL_PATH = Path(os.environ.get("KOKORO_MODEL", str(APP_ROOT / "models" / "kokoro-v1.0.onnx"))).expanduser()
VOICES_PATH = Path(os.environ.get("KOKORO_VOICES", str(APP_ROOT / "models" / "voices-v1.0.bin"))).expanduser()

BACKEND_HOST = os.environ.get("BACKEND_HOST", os.environ.get("HOST", "127.0.0.1"))
BACKEND_PORT = int(os.environ.get("BACKEND_PORT", os.environ.get("PORT", "7860")))
API_PREFIX = os.environ.get("API_PREFIX", os.environ.get("VITE_API_PREFIX", "api")).strip("/")

# ---------------------------------------------------------------------------
# Custom error
# ---------------------------------------------------------------------------


class PlaygroundError(Exception):
    """Raise for user-facing errors that should become JSON responses."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


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
                accent_id, accent_label, accent_flag = resolve_accent(key, locale)
                voices.append(
                    VoiceProfile(
                        id=key,
                        label=key.replace("_", " ").title(),
                        locale=locale,
                        gender=None,
                        tags=[],
                        accent_id=accent_id,
                        accent_label=accent_label,
                        accent_flag=accent_flag,
                    )
                )

        _cached_voices = voices
        return voices


def serialise_voice_profile(voice: VoiceProfile) -> Dict[str, Any]:
    return {
        "id": voice.id,
        "label": voice.label,
        "locale": voice.locale,
        "gender": voice.gender,
        "tags": voice.tags,
        "notes": voice.notes,
        "accent": {
            "id": voice.accent_id,
            "label": voice.accent_label,
            "flag": voice.accent_flag,
        },
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



def build_kokoro_voice_payload() -> Dict[str, Any]:
    voices = load_voice_profiles()
    accent_groups = group_voices_by_accent(voices)
    return {
        "voices": [serialise_voice_profile(voice) for voice in voices],
        "accentGroups": accent_groups,
        "groups": accent_groups,
        "count": len(voices),
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
    "af": ("us_female", "American English · Female", "🇺🇸"),
    "am": ("us_male", "American English · Male", "🇺🇸"),
    "bf": ("uk_female", "British English · Female", "🇬🇧"),
    "bm": ("uk_male", "British English · Male", "🇬🇧"),
}

ACCENT_LOCALE_MAP: Dict[str, Tuple[str, str, str]] = {
    "en-us": ("us", "American English", "🇺🇸"),
    "en-gb": ("uk", "British English", "🇬🇧"),
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
    "zh-cn": ("zh", "Chinese", "🇨🇳"),
}

DEFAULT_ACCENT: Tuple[str, str, str] = ("other", "Other / Mixed", "🌐")


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
            json={"model": model, "prompt": prompt, "options": {"temperature": temperature, "top_p": 0.9}},
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

    return {
        "id": filename,
        "voice": voice,
        "sample_rate": sample_rate,
        "path": f"/audio/{filename}",
        "filename": filename,
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


# ---------------------------------------------------------------------------
# Flask app & routes
# ---------------------------------------------------------------------------

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
api = Blueprint("api", __name__)


@app.errorhandler(PlaygroundError)
def handle_playground_error(err: PlaygroundError):
    payload = {"error": str(err), "status": err.status}
    return make_response(jsonify(payload), err.status)


@app.errorhandler(Exception)
def handle_generic_error(err: Exception):  # pragma: no cover
    payload = {"error": str(err), "status": 500}
    return make_response(jsonify(payload), 500)


@api.route("/meta", methods=["GET"])
def meta_endpoint():
    has_model = MODEL_PATH.exists()
    has_voices = VOICES_PATH.exists()
    bundle_index = FRONTEND_DIST / "index.html"
    ollama_info = list_ollama_models()
    kokoro_voice_payload = build_kokoro_voice_payload()
    accent_groups = kokoro_voice_payload["accentGroups"]
    engines_meta = [serialise_engine_meta(engine) for engine in ENGINE_REGISTRY.values()]

    return jsonify(
        {
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
        }
    )


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
        "description": "Coqui XTTS voice cloning (integration pending).",
        "availability": lambda: False,
        "requires_voice": True,
        "supports": {"cloning": True},
        "status": "planned",
    },
    "openvoice": {
        "id": "openvoice",
        "label": "OpenVoice v2",
        "description": "OpenVoice instant voice cloning (integration pending).",
        "availability": lambda: False,
        "requires_voice": False,
        "supports": {"cloning": True, "styles": True},
        "status": "planned",
    },
    "chattts": {
        "id": "chattts",
        "label": "ChatTTS",
        "description": "ChatTTS dialogue model (integration pending).",
        "availability": lambda: False,
        "requires_voice": False,
        "supports": {"cloning": False},
        "status": "planned",
    },
}


@api.route("/synthesise", methods=["POST"])
@api.route("/synthesize", methods=["POST"])
def synthesise_endpoint():
    raw_payload = parse_json_request()
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


def render_announcer_segments(
    announcer_cfg: Dict[str, Any],
    voice_id: str,
    voice_profile: VoiceProfile,
    base_language: str,
    base_speed: float,
    base_trim: bool,
) -> Tuple[List[np.ndarray], Optional[int]]:
    segments: List[np.ndarray] = []
    sample_rate: Optional[int] = None
    resolved_voice = announcer_cfg.get("voice") or voice_id
    template = (announcer_cfg.get("template") or "Now auditioning {voice_label}").strip()
    speed = float(announcer_cfg.get("speed", base_speed))
    trim = bool(announcer_cfg.get("trim", announcer_cfg.get("trim_silence", base_trim)))
    gap_seconds = float(announcer_cfg.get("gapSeconds", announcer_cfg.get("gap_seconds", 0.5)))

    tts = get_tts()
    try:
        announcer_text = template.format(voice=voice_id, voice_label=voice_profile.label)
    except Exception:
        announcer_text = template

    ann_audio, ann_sr = tts.create(
        announcer_text,
        voice=resolved_voice,
        speed=speed,
        lang=base_language,
        trim=trim,
    )
    ann_audio = np.squeeze(ann_audio).astype(np.float32)
    segments.append(ann_audio)
    if gap_seconds > 0:
        gap = np.zeros(int(ann_sr * gap_seconds), dtype=np.float32)
        segments.append(gap)
    sample_rate = ann_sr
    return segments, sample_rate


@api.route("/audition", methods=["POST"])
def audition_endpoint():
    payload = parse_json_request()
    engine, _ = resolve_engine(payload.get("engine"))
    if engine["id"] != "kokoro":
        raise PlaygroundError("Auditions are currently only supported for Kokoro voices.", status=400)

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
    announcer_cfg = payload.get("announcer") or {}
    announcer_enabled = bool(announcer_cfg.get("enabled"))

    catalogue = {voice.id: voice for voice in load_voice_profiles()}
    for voice_id in voice_ids:
        if voice_id not in catalogue:
            raise PlaygroundError(f"Unknown voice id '{voice_id}'.", status=400)

    tts = get_tts()
    sample_rate: Optional[int] = None
    clips: List[np.ndarray] = []

    for voice_id in voice_ids:
        voice_profile = catalogue[voice_id]
        segments: List[np.ndarray] = []

        if announcer_enabled:
            announcer_segments, ann_sr = render_announcer_segments(
                announcer_cfg,
                voice_id,
                voice_profile,
                base_payload["language"],
                base_payload["speed"],
                base_payload["trim_silence"],
            )
            segments.extend(announcer_segments)
            if ann_sr is not None:
                if sample_rate is None:
                    sample_rate = ann_sr
                elif sample_rate != ann_sr:
                    raise PlaygroundError("Sample rate mismatch between announcer segments.", status=500)

        audio, sr = tts.create(
            base_payload["text"],
            voice=voice_id,
            speed=base_payload["speed"],
            lang=base_payload["language"],
            trim=base_payload["trim_silence"],
        )
        audio = np.squeeze(audio).astype(np.float32)
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


@app.route("/audio/<path:filename>", methods=["GET"])
def audio_endpoint(filename: str):
    return send_from_directory(OUTPUT_DIR, filename, as_attachment=False)


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
