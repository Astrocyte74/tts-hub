#!/usr/bin/env python3
"""
Favorites CLI for Kokoro Playground

- Lists favorites (with engine/tag filters)
- Synthesises audio by favorite slug or id
- Interactive chooser to pick a favorite and enter text
 - Optionally downloads the returned audio and plays it (macOS 'afplay')

Environment
  TTSHUB_API_BASE (default http://127.0.0.1:7860/api)
  TTSHUB_API_KEY  (optional; if backend enforces favorites auth)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
import shutil


API_BASE = os.environ.get("TTSHUB_API_BASE", "http://127.0.0.1:7860/api").rstrip("/")
API_KEY = os.environ.get("TTSHUB_API_KEY")


def _headers() -> Dict[str, str]:
    h = {"Content-Type": "application/json"}
    if API_KEY:
        h["Authorization"] = f"Bearer {API_KEY}"
    return h


def _http_json(method: str, path: str, body: Optional[Dict[str, Any]] = None, *, auth_for_favorites: bool = False) -> Any:
    url = f"{API_BASE}/{path.lstrip('/')}"
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if auth_for_favorites and API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:  # nosec - local trusted endpoint
            payload = resp.read().decode("utf-8")
            if not payload:
                return None
            return json.loads(payload)
    except urllib.error.HTTPError as e:
        try:
            text = e.read().decode("utf-8")
        except Exception:
            text = str(e)
        raise SystemExit(f"HTTP {e.code} for {method} {url}: {text}")
    except urllib.error.URLError as e:
        raise SystemExit(f"Failed to reach {url}: {e}")


def _resolve_audio_url(value: str) -> str:
    if not value:
        return value
    if value.startswith("http://") or value.startswith("https://"):
        return value
    # relative path -> resolve against API host (strip trailing /api if present)
    base = API_BASE
    if base.endswith("/api"):
        base = base[:-4]
    return urllib.parse.urljoin(base + "/", value.lstrip("/"))


def list_favorites(engine: Optional[str] = None, tag: Optional[str] = None) -> Dict[str, Any]:
    qs = []
    if engine:
        qs.append(("engine", engine))
    if tag:
        qs.append(("tag", tag))
    path = "favorites"
    if qs:
        path += "?" + urllib.parse.urlencode(qs)
    return _http_json("GET", path, auth_for_favorites=True)


def get_favorite(profile_id: str) -> Dict[str, Any]:
    return _http_json("GET", f"favorites/{urllib.parse.quote(profile_id)}", auth_for_favorites=True)


def patch_favorite(profile_id: str, patch: Dict[str, Any]) -> Dict[str, Any]:
    return _http_json("PATCH", f"favorites/{urllib.parse.quote(profile_id)}", patch, auth_for_favorites=True)


def export_favorites() -> Dict[str, Any]:
    return _http_json("GET", "favorites/export", auth_for_favorites=True)


def import_favorites(payload: Dict[str, Any], mode: str = "merge") -> Dict[str, Any]:
    body = dict(payload)
    body.setdefault("mode", mode)
    return _http_json("POST", "favorites/import", body, auth_for_favorites=True)


def synthesise_by_favorite(text: str, *, slug: Optional[str] = None, fav_id: Optional[str] = None) -> Dict[str, Any]:
    if not slug and not fav_id:
        raise SystemExit("Provide --slug or --id")
    payload: Dict[str, Any] = {"text": text}
    if slug:
        payload["favoriteSlug"] = slug
    if fav_id:
        payload["favoriteId"] = fav_id
    return _http_json("POST", "synthesise", payload, auth_for_favorites=False)


def download_audio(url: str, out_path: str) -> str:
    resolved = _resolve_audio_url(url)
    with urllib.request.urlopen(resolved) as resp:  # nosec - local trusted endpoint
        data = resp.read()
    out_dir = os.path.dirname(out_path) or "."
    os.makedirs(out_dir, exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(data)
    return os.path.abspath(out_path)


def maybe_play(path: str) -> None:
    afplay = shutil.which("afplay")
    if afplay:
        try:
            os.spawnlp(os.P_WAIT, afplay, afplay, path)  # nosec - local tool
        except Exception:
            pass


def cmd_list(args: argparse.Namespace) -> None:
    res = list_favorites(engine=args.engine, tag=args.tag)
    if args.json:
        print(json.dumps(res, indent=2))
        return
    profiles = res.get("profiles", [])
    if not profiles:
        print("No favorites found.")
        return
    for i, p in enumerate(profiles, start=1):
        label = p.get("label") or p.get("slug") or p.get("id")
        engine = p.get("engine")
        voice = p.get("voiceId")
        slug = p.get("slug")
        tags = ",".join(p.get("tags") or [])
        print(f"{i:2d}. {label}  [{engine} · {voice}]  slug={slug}  tags={tags}")


def cmd_synth(args: argparse.Namespace) -> None:
    text = args.text or sys.stdin.read().strip()
    if not text:
        raise SystemExit("Provide --text or pipe text on stdin")
    res = synthesise_by_favorite(text, slug=args.slug, fav_id=args.id)
    url = (
        res.get("url")
        or res.get("audio_url")
        or res.get("path")
        or res.get("clip")
        or res.get("filename")
        or res.get("file")
    )
    if not url:
        print(json.dumps(res, indent=2))
        raise SystemExit("No audio URL/path found in response.")
    resolved = _resolve_audio_url(str(url))
    print(f"Audio: {resolved}")
    if args.download:
        target = args.download
        if target.endswith("/") or target.endswith(os.sep):
            # save under a folder with the filename
            filename = os.path.basename(str(res.get("filename") or str(url).split("/")[-1]))
            target = os.path.join(target, filename)
        saved = download_audio(resolved, target)
        print(f"Saved: {saved}")
        if args.play:
            maybe_play(saved)


def cmd_choose(args: argparse.Namespace) -> None:
    payload = list_favorites(engine=args.engine, tag=args.tag)
    profiles = payload.get("profiles", [])
    if not profiles:
        raise SystemExit("No favorites match your filters.")
    # sort by label
    profiles.sort(key=lambda p: str(p.get("label") or p.get("slug") or p.get("id")))
    for i, p in enumerate(profiles, start=1):
        label = p.get("label") or p.get("slug") or p.get("id")
        engine = p.get("engine")
        voice = p.get("voiceId")
        tags = ",".join(p.get("tags") or [])
        print(f"{i:2d}. {label}  [{engine} · {voice}]  tags={tags}")
    try:
        idx = int(input("Select favorite #: ").strip())
    except Exception:
        raise SystemExit("Invalid selection")
    if not (1 <= idx <= len(profiles)):
        raise SystemExit("Out of range")
    chosen = profiles[idx - 1]
    text = args.text or input("Enter text to synthesise: ").strip()
    if not text:
        raise SystemExit("No text provided")
    res = synthesise_by_favorite(text, slug=chosen.get("slug"))
    url = (
        res.get("url")
        or res.get("audio_url")
        or res.get("path")
        or res.get("clip")
        or res.get("filename")
        or res.get("file")
    )
    if not url:
        print(json.dumps(res, indent=2))
        raise SystemExit("No audio URL/path found in response.")
    resolved = _resolve_audio_url(str(url))
    print(f"Audio: {resolved}")
    if args.download:
        target = args.download
        if target.endswith("/") or target.endswith(os.sep):
            filename = os.path.basename(str(res.get("filename") or str(url).split("/")[-1]))
            target = os.path.join(target, filename)
        saved = download_audio(resolved, target)
        print(f"Saved: {saved}")
        if args.play:
            maybe_play(saved)


def cmd_export(args: argparse.Namespace) -> None:
    data = export_favorites()
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(args.out)
    else:
        print(json.dumps(data, indent=2))


def cmd_import(args: argparse.Namespace) -> None:
    with open(args.path, "r", encoding="utf-8") as f:
        data = json.load(f)
    res = import_favorites(data, mode=args.mode)
    print(json.dumps(res, indent=2))


def main(argv: Optional[List[str]] = None) -> None:
    p = argparse.ArgumentParser(description="Favorites CLI for Kokoro Playground")
    sub = p.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list", help="List favorites")
    p_list.add_argument("--engine", help="Filter by engine id", default=None)
    p_list.add_argument("--tag", help="Filter by tag", default=None)
    p_list.add_argument("--json", action="store_true", help="Print raw JSON")
    p_list.set_defaults(func=cmd_list)

    p_synth = sub.add_parser("synth", help="Synthesise by favorite slug or id")
    g = p_synth.add_mutually_exclusive_group(required=True)
    g.add_argument("--slug", help="favoriteSlug")
    g.add_argument("--id", help="favoriteId")
    p_synth.add_argument("--text", help="Text to synthesise (or pipe on stdin)")
    p_synth.add_argument("--download", help="Save audio to path (or folder/)")
    p_synth.add_argument("--play", action="store_true", help="Attempt to play audio (macOS)")
    p_synth.set_defaults(func=cmd_synth)

    p_choose = sub.add_parser("choose", help="Interactive: pick a favorite and synthesise")
    p_choose.add_argument("--engine", help="Filter by engine id", default=None)
    p_choose.add_argument("--tag", help="Filter by tag", default=None)
    p_choose.add_argument("--text", help="Text to synthesise (optional; prompt if not provided)")
    p_choose.add_argument("--download", help="Save audio to path (or folder/)")
    p_choose.add_argument("--play", action="store_true", help="Attempt to play audio (macOS)")
    p_choose.set_defaults(func=cmd_choose)

    p_exp = sub.add_parser("export", help="Export favorites JSON")
    p_exp.add_argument("--out", help="Write to file (defaults to stdout)")
    p_exp.set_defaults(func=cmd_export)

    p_imp = sub.add_parser("import", help="Import favorites JSON")
    p_imp.add_argument("path", help="Path to favorites.json")
    p_imp.add_argument("--mode", choices=["merge", "replace"], default="merge")
    p_imp.set_defaults(func=cmd_import)

    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()

