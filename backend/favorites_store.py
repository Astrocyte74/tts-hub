from __future__ import annotations

import json
import os
import threading
import time
import uuid
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


SchemaVersion = 1


@dataclass
class Profile:
    id: str
    label: str
    engine: str
    voiceId: str
    slug: Optional[str] = None
    language: Optional[str] = None
    speed: Optional[float] = None
    trimSilence: Optional[bool] = None
    style: Optional[str] = None         # OpenVoice
    seed: Optional[int] = None          # ChatTTS
    serverUrl: Optional[str] = None     # XTTS
    tags: Optional[List[str]] = None
    meta: Optional[Dict[str, Any]] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _slugify(value: str) -> str:
    s = []
    for ch in value.lower():
        if ch.isalnum():
            s.append(ch)
        elif ch in {" ", "-", "_"}:
            s.append("-")
    slug = "".join(s).strip("-")
    return slug or value.lower()


class FavoritesStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._write({"schemaVersion": SchemaVersion, "profiles": []})

    # ---------- low-level IO ----------
    def _read(self) -> Dict[str, Any]:
        try:
            with self.path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            return {"schemaVersion": SchemaVersion, "profiles": []}

    def _write(self, data: Dict[str, Any]) -> None:
        tmp = self.path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, self.path)

    # ---------- helpers ----------
    def _load_profiles(self) -> List[Dict[str, Any]]:
        data = self._read()
        profiles = data.get("profiles")
        return list(profiles) if isinstance(profiles, list) else []

    def _save_profiles(self, profiles: List[Dict[str, Any]]) -> None:
        payload = {"schemaVersion": SchemaVersion, "profiles": profiles}
        self._write(payload)

    def _unique_slug(self, slug: str, existing: List[Dict[str, Any]], *, exclude_id: Optional[str] = None) -> str:
        base = _slugify(slug)
        candidate = base
        suffix = 1
        existing_slugs = {str(p.get("slug")) for p in existing if p.get("slug") and p.get("id") != exclude_id}
        while candidate and candidate in existing_slugs:
            suffix += 1
            candidate = f"{base}-{suffix}"
        return candidate

    # ---------- public API ----------
    def list(self) -> List[Dict[str, Any]]:
        with self._lock:
            profiles = self._load_profiles()
            profiles.sort(key=lambda p: p.get("updatedAt") or p.get("createdAt") or "", reverse=True)
            return profiles

    def get(self, profile_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            for p in self._load_profiles():
                if str(p.get("id")) == str(profile_id):
                    return p
        return None

    def get_by_slug(self, slug: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            for p in self._load_profiles():
                if p.get("slug") == slug:
                    return p
        return None

    def create(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        required = ["label", "engine", "voiceId"]
        for key in required:
            if not payload.get(key):
                raise ValueError(f"Missing field '{key}'")
        now = _now_iso()
        with self._lock:
            profiles = self._load_profiles()
            pid = payload.get("id") or f"fav_{uuid.uuid4().hex[:12]}"
            slug = payload.get("slug") or _slugify(payload["label"])[:60]
            slug = self._unique_slug(slug, profiles)
            record = {
                "id": pid,
                "label": str(payload["label"]).strip(),
                "engine": str(payload["engine"]).lower().strip(),
                "voiceId": str(payload["voiceId"]).strip(),
                "slug": slug,
                "language": payload.get("language"),
                "speed": payload.get("speed"),
                "trimSilence": payload.get("trimSilence"),
                "style": payload.get("style"),
                "seed": payload.get("seed"),
                "serverUrl": payload.get("serverUrl"),
                "tags": payload.get("tags") or [],
                "meta": payload.get("meta") or {},
                "createdAt": now,
                "updatedAt": now,
            }
            profiles.append(record)
            self._save_profiles(profiles)
            return record

    def update(self, profile_id: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        with self._lock:
            profiles = self._load_profiles()
            found = None
            for p in profiles:
                if str(p.get("id")) == str(profile_id):
                    found = p
                    break
            if not found:
                return None
            for key in [
                "label",
                "engine",
                "voiceId",
                "language",
                "speed",
                "trimSilence",
                "style",
                "seed",
                "serverUrl",
                "tags",
                "meta",
            ]:
                if key in patch:
                    found[key] = patch[key]
            if "slug" in patch and patch["slug"]:
                found["slug"] = self._unique_slug(str(patch["slug"]), profiles, exclude_id=found["id"])[:60]
            found["updatedAt"] = _now_iso()
            self._save_profiles(profiles)
            return found

    def delete(self, profile_id: str) -> bool:
        with self._lock:
            profiles = self._load_profiles()
            next_profiles = [p for p in profiles if str(p.get("id")) != str(profile_id)]
            if len(next_profiles) == len(profiles):
                return False
            self._save_profiles(next_profiles)
            return True

    def export(self) -> Dict[str, Any]:
        with self._lock:
            return {"schemaVersion": SchemaVersion, "profiles": self._load_profiles()}

    def import_(self, payload: Dict[str, Any], *, mode: str = "merge") -> int:
        incoming = payload.get("profiles")
        if not isinstance(incoming, list):
            return 0
        with self._lock:
            profiles = [] if mode == "replace" else self._load_profiles()
            existing_ids = {p.get("id") for p in profiles}
            existing_slugs = {p.get("slug") for p in profiles}
            count = 0
            for p in incoming:
                if not isinstance(p, dict):
                    continue
                label = str(p.get("label") or "").strip()
                engine = str(p.get("engine") or "").strip().lower()
                voice_id = str(p.get("voiceId") or "").strip()
                if not (label and engine and voice_id):
                    continue
                rec = dict(p)
                rec.setdefault("id", f"fav_{uuid.uuid4().hex[:12]}")
                if rec["id"] in existing_ids:
                    rec["id"] = f"fav_{uuid.uuid4().hex[:12]}"
                slug = str(rec.get("slug") or _slugify(label))[:60]
                suffix = 1
                base = slug
                while slug in existing_slugs:
                    suffix += 1
                    slug = f"{base}-{suffix}"
                rec["slug"] = slug
                rec.setdefault("createdAt", _now_iso())
                rec["updatedAt"] = _now_iso()
                profiles.append(rec)
                existing_ids.add(rec["id"])
                existing_slugs.add(rec["slug"])
                count += 1
            self._save_profiles(profiles)
            return count

