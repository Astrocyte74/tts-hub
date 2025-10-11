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

TTS_HUB_ROOT = APP_ROOT.parent
XTTS_ROOT = Path(os.environ.get("XTTS_ROOT", TTS_HUB_ROOT / "XTTS")).expanduser()
XTTS_SERVICE_DIR = Path(os.environ.get("XTTS_SERVICE_DIR", XTTS_ROOT / "tts-service")).expanduser()
XTTS_PYTHON = Path(os.environ.get("XTTS_PYTHON", XTTS_SERVICE_DIR / ".venv" / "bin" / "python")).expanduser()
XTTS_VOICE_DIR = Path(os.environ.get("XTTS_VOICE_DIR", XTTS_SERVICE_DIR / "voices")).expanduser()
XTTS_OUTPUT_FORMAT = os.environ.get("XTTS_OUTPUT_FORMAT", "wav").lower()
XTTS_TIMEOUT_SECONDS = float(os.environ.get("XTTS_TIMEOUT", "120"))
XTTS_SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg"}

_xtts_voice_cache: Dict[str, Path] = {}
_xtts_voice_lock = threading.Lock()

_openvoice_voice_cache: Dict[str, Dict[str, Any]] = {}
_openvoice_voice_lock = threading.Lock()
_openvoice_style_cache: Optional[Dict[str, List[str]]] = None
_openvoice_style_lock = threading.Lock()

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
        "engine": "kokoro",
        "available": MODEL_PATH.exists() and VOICES_PATH.exists(),
        "voices": [serialise_voice_profile(voice) for voice in voices],
        "accentGroups": accent_groups,
        "groups": accent_groups,
        "count": len(voices),
    }


def _slugify_voice_id(name: str) -> str:
    slug_chars: list[str] = []
    for char in name.lower():
        if char.isalnum():
            slug_chars.append(char)
        elif char in {' ', '-', '_'}:
            slug_chars.append('_')
    slug = ''.join(slug_chars).strip('_')
    return slug or name.lower()


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
        voices.append(
            {
                'id': voice_id,
                'label': label,
                'locale': None,
                'gender': None,
                'tags': [],
                'notes': voice_path.name,
                'accent': {'id': 'custom', 'label': 'Custom Voice', 'flag': '🎙️'},
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
    return {
        'engine': 'xtts',
        'available': bool(mapping) and XTTS_PYTHON.exists() and XTTS_SERVICE_DIR.exists(),
        'voices': voices,
        'accentGroups': groups,
        'groups': groups,
        'count': len(voices),
        'message': message,
    }


def xtts_is_available() -> bool:
    if not XTTS_PYTHON.exists() or not XTTS_PYTHON.is_file():
        return False
    if not XTTS_SERVICE_DIR.exists():
        return False
    voice_map = get_xtts_voice_map()
    return bool(voice_map)


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



def _normalise_openvoice_language(value: Optional[str]) -> str:
    if not value:
        return "English"
    token = value.strip().lower()
    if token.startswith("zh") or token.startswith("ch") or "chinese" in token:
        return "Chinese"
    return "English"


def load_openvoice_styles() -> Dict[str, List[str]]:
    with _openvoice_style_lock:
        if _openvoice_style_cache is not None:
            return dict(_openvoice_style_cache)
        mapping: Dict[str, List[str]] = {}
        language_dirs = {
            "English": OPENVOICE_CKPT_ROOT / "base_speakers" / "EN" / "config.json",
            "Chinese": OPENVOICE_CKPT_ROOT / "base_speakers" / "ZH" / "config.json",
        }
        for language, config_path in language_dirs.items():
            if not config_path.exists():
                continue
            try:
                with config_path.open("r", encoding="utf-8") as config_file:
                    config_data = json.load(config_file)
                speaker_map = config_data.get("speakers", {})
                styles = sorted(str(name) for name in speaker_map.keys())
                if styles:
                    mapping[language] = styles
            except (OSError, json.JSONDecodeError):
                continue
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
            mapping[voice_id] = {
                "path": path.resolve(),
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
        "Chinese": ("openvoice_zh", "OpenVoice Chinese", "🇨🇳"),
    }
    voices: List[Dict[str, Any]] = []
    grouped: Dict[str, List[str]] = {}
    for voice_id, meta in voice_map.items():
        language = meta.get("language", "English")
        accent = accent_map.get(language, accent_map["English"])
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
                    "language": language,
                    "style": meta.get("style", "default"),
                },
            }
        )
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
    return {
        "engine": "openvoice",
        "available": available,
        "voices": voices,
        "accentGroups": accent_groups,
        "groups": accent_groups,
        "count": len(voices),
        "styles": styles_map.get("English", []),
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
    available_styles = styles_map.get(language, [])
    requested_style = str(payload.get("style") or meta.get("style") or (available_styles[0] if available_styles else "default"))
    if available_styles and requested_style not in available_styles:
        raise PlaygroundError(
            f"Style '{requested_style}' is not available for OpenVoice {language}.",
            status=400,
        )

    watermark = str(payload.get("watermark") or OPENVOICE_WATERMARK)
    return {
        "text": base["text"],
        "voice_id": voice_identifier,
        "reference_path": meta["path"],
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

    return {
        "id": filename,
        "engine": "openvoice",
        "voice": data["voice_id"],
        "path": f"/audio/{filename}",
        "filename": filename,
        "sample_rate": data["sample_rate"],
    }



def build_chattts_voice_payload() -> Dict[str, Any]:
    available = chattts_is_available()
    voices: List[Dict[str, Any]] = []
    if available:
        voices.append(
            {
                'id': 'chattts_random',
                'label': 'Random Speaker',
                'locale': None,
                'gender': None,
                'tags': ['ChatTTS'],
                'notes': 'Sampled from ChatTTS model at runtime.',
                'accent': {'id': 'chattts', 'label': 'ChatTTS', 'flag': '🎤'},
            }
        )
    return {
        'engine': 'chattts',
        'available': available,
        'voices': voices,
        'accentGroups': [],
        'groups': [],
        'count': len(voices),
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


def _get_chattts_python() -> Path:
    if CHATTT_PYTHON.exists() and CHATTT_PYTHON.is_file():
        return CHATTT_PYTHON
    return Path(sys.executable).resolve()


def _chattts_prepare_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    base = validate_synthesis_payload(payload, require_voice=False)
    voice = base.get('voice') or 'chattts_random'
    speaker = payload.get('speaker')
    text = base['text']
    return {
        'text': text,
        'voice_id': voice,
        'speaker': speaker if isinstance(speaker, str) and speaker.strip() else None,
        'format': 'mp3',
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
