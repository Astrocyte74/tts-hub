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
from typing import Any, Dict, List, Optional
import shutil


API_BASE = os.environ.get("TTSHUB_API_BASE", "http://127.0.0.1:7860/api").rstrip("/")
API_KEY = os.environ.get("TTSHUB_API_KEY")

# Menu‑level sticky filters (persist for the process)
MENU_ENGINE: Optional[str] = None
MENU_TAG: Optional[str] = None


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
    return _http_json("POST", "synthesise", payload)


def download_audio(url: str, out_path: str) -> str:
    resolved = _resolve_audio_url(url)
    with urllib.request.urlopen(resolved) as resp:  # nosec
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
            os.spawnlp(os.P_WAIT, afplay, afplay, path)  # nosec
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
            filename = os.path.basename(str(res.get("filename") or str(url).split("/")[-1]))
            target = os.path.join(target, filename)
        saved = download_audio(resolved, target)
        print(f"Saved: {saved}")
        if args.play:
            maybe_play(saved)


def _input(prompt: str) -> str:
    try:
        return input(prompt)
    except EOFError:
        return ""


def _prompt_choice(title: str, options: List[str], *, allow_back: bool = True) -> Optional[int]:
    print(title)
    for i, opt in enumerate(options, start=1):
        print(f"  {i}. {opt}")
    if allow_back:
        print("  0. Back")
    raw = _input("Select: ").strip()
    if allow_back and raw in {"", "0"}:
        return None
    try:
        idx = int(raw)
    except Exception:
        return None
    if 1 <= idx <= len(options):
        return idx - 1
    return None


def _set_filters() -> None:
    global MENU_ENGINE, MENU_TAG
    res = list_favorites()
    profiles = res.get("profiles", [])
    engines = sorted({str(p.get("engine")) for p in profiles if p.get("engine")})
    tags = sorted({t for p in profiles for t in (p.get("tags") or []) if t})
    if engines:
        current = MENU_ENGINE or "all"
        print(f"Engines (current: {current})")
        idx = _prompt_choice("Select engine", ["all"] + engines)
        if idx is None:
            pass
        elif idx == 0:
            MENU_ENGINE = None
        else:
            MENU_ENGINE = engines[idx - 1]
    if tags:
        current = MENU_TAG or "all"
        print(f"Tags (current: {current})")
        idx = _prompt_choice("Select tag", ["all"] + tags)
        if idx is None:
            pass
        elif idx == 0:
            MENU_TAG = None
        else:
            MENU_TAG = tags[idx - 1]


def _menu_list() -> None:
    res = list_favorites(engine=MENU_ENGINE, tag=MENU_TAG)
    profiles = res.get("profiles", [])
    if not profiles:
        print("No favorites match current filters. Use 'Change filters' to adjust.")
        return
    for i, p in enumerate(profiles, start=1):
        label = p.get("label") or p.get("slug") or p.get("id")
        engine = p.get("engine")
        voice = p.get("voiceId")
        tags = ",".join(p.get("tags") or [])
        print(f"{i:2d}. {label}  [{engine} · {voice}]  tags={tags}")


def _menu_choose() -> None:
    payload = list_favorites(engine=MENU_ENGINE, tag=MENU_TAG)
    profiles = payload.get("profiles", [])
    if not profiles:
        print("No favorites match current filters. Use 'Change filters' to adjust.")
        return
    profiles.sort(key=lambda p: str(p.get("label") or p.get("slug") or p.get("id")))
    for i, p in enumerate(profiles, start=1):
        label = p.get("label") or p.get("slug") or p.get("id")
        engine = p.get("engine")
        voice = p.get("voiceId")
        tags = ",".join(p.get("tags") or [])
        print(f"{i:2d}. {label}  [{engine} · {voice}]  tags={tags}")
    try:
        idx = int(_input("Select favorite #: ").strip())
    except Exception:
        print("Cancelled.")
        return
    if not (1 <= idx <= len(profiles)):
        print("Out of range.")
        return
    chosen = profiles[idx - 1]
    text = _input("Enter text to synthesise: ").strip()
    if not text:
        print("No text provided.")
        return
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
        print("No audio URL/path found in response.")
        return
    resolved = _resolve_audio_url(str(url))
    print(f"Audio: {resolved}")
    dn = _input("Download? [y/N]: ").strip().lower()
    if dn == "y":
        target = _input("Save as (path or folder/): ").strip() or "out/"
        if target.endswith("/") or target.endswith(os.sep):
            filename = os.path.basename(str(res.get("filename") or str(url).split("/")[-1]))
            target = os.path.join(target, filename)
        saved = download_audio(resolved, target)
        print(f"Saved: {saved}")
        if _input("Play now? [y/N]: ").strip().lower() == "y":
            maybe_play(saved)


def _menu_settings() -> None:
    global API_BASE, API_KEY
    print(f"API base: {API_BASE}")
    print(f"API key:  {'<set>' if API_KEY else '<none>'}")
    new_base = _input("New API base (blank to keep): ").strip()
    if new_base:
        API_BASE = new_base.rstrip("/")
    new_key = _input("New API key (blank keep, '-' to clear): ").strip()
    if new_key == "-":
        API_KEY = None
    elif new_key:
        API_KEY = new_key
    print("Settings updated.")


def cmd_menu(args: argparse.Namespace) -> None:
    while True:
        engine_label = MENU_ENGINE or "all"
        tag_label = MENU_TAG or "all"
        print("\nFavorites CLI — Menu")
        print(f"  Filters → engine: {engine_label} · tag: {tag_label}")
        print("  1. List favorites")
        print("  2. Choose favorite and synthesise")
        print("  3. Change filters")
        print("  4. Export favorites")
        print("  5. Import favorites")
        print("  6. Settings (API base/key)")
        print("  0. Exit")
        choice = _input("Select: ").strip()
        if choice in {"", "0"}:
            return
        if choice == "1":
            _menu_list()
        elif choice == "2":
            _menu_choose()
        elif choice == "3":
            _set_filters()
        elif choice == "4":
            path = _input("Write export to (favorites.json): ").strip() or "favorites.json"
            data = export_favorites()
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            print(f"Wrote {path}")
        elif choice == "5":
            path = _input("Import file path: ").strip()
            if not path:
                print("Cancelled.")
                continue
            mode = _input("Mode [merge/replace] (merge): ").strip().lower() or "merge"
            with open(path, "r", encoding="utf-8") as f:
                payload = json.load(f)
            res = import_favorites(payload, mode=mode)
            print(json.dumps(res, indent=2))
        elif choice == "6":
            _menu_settings()
        else:
            print("Unknown choice.")


def main(argv: Optional[List[str]] = None) -> None:
    p = argparse.ArgumentParser(description="Favorites CLI for Kokoro Playground")
    sub = p.add_subparsers(dest="cmd", required=False)

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

    p_menu = sub.add_parser("menu", help="Interactive menu mode")
    p_menu.set_defaults(func=cmd_menu)

    args = p.parse_args(argv)
    if not getattr(args, "cmd", None):
        return cmd_menu(argparse.Namespace())
    args.func(args)


if __name__ == "__main__":
    main()

