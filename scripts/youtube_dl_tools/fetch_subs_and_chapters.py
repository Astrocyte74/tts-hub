#!/usr/bin/env python3
"""
Fetch English subtitles (manual + auto) and chapters for one or more
YouTube URLs using the system `yt-dlp` CLI, saving outputs under:

  scripts/youtube_dl_tools/downloads/<video_id>/

Artifacts per video_id:
- info.json (full metadata from yt-dlp -J)
- *.en.vtt / *.en-orig.vtt (if available)

Usage examples:
  python scripts/youtube_dl_tools/fetch_subs_and_chapters.py \
    https://www.youtube.com/watch?v=6fI1JCmfyJg

  python scripts/youtube_dl_tools/fetch_subs_and_chapters.py \
    --lang 'en.*' https://www.youtube.com/watch?v=VIDEO_ID ...

Notes:
- Requires `yt-dlp` available on PATH (Homebrew install recommended).
- This script shells out to the yt-dlp binary rather than importing the
  Python package, to avoid pip/pyenv dependency variance.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import List


def run(cmd: List[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True, text=True, capture_output=True)


def ensure_yt_dlp_available() -> str:
    path = shutil.which("yt-dlp")
    if not path:
        print("Error: yt-dlp not found on PATH. Install via Homebrew: brew install yt-dlp", file=sys.stderr)
        sys.exit(1)
    return path


def fetch_info_json(url: str) -> dict:
    # Use yt-dlp -J to get full metadata as JSON
    try:
        cp = run(["yt-dlp", "-J", "--no-warnings", url])
    except subprocess.CalledProcessError as e:
        print(e.stderr or e.stdout, file=sys.stderr)
        raise
    return json.loads(cp.stdout)


def format_mmss(seconds: float | int | None) -> str:
    if seconds is None:
        return "—"
    s = int(seconds)
    m, s = divmod(s, 60)
    return f"{m:02d}:{s:02d}"


def print_chapters(info: dict) -> None:
    chapters = info.get("chapters") or []
    print(f"Chapters found: {len(chapters)}")
    for i, ch in enumerate(chapters, 1):
        st = format_mmss(ch.get("start_time"))
        et = format_mmss(ch.get("end_time"))
        title = ch.get("title", "")
        print(f"{i:02d}. {st} - {et}  {title}")


def download_subtitles(url: str, dest_dir: Path, lang: str) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        "yt-dlp",
        "--no-progress",
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        lang,
        "--sub-format",
        "vtt",
        "-o",
        "%(id)s.%(ext)s",
        "-P",
        str(dest_dir),
        url,
    ]
    try:
        cp = run(cmd)
    except subprocess.CalledProcessError as e:
        # Show yt-dlp output to aid troubleshooting, but do not crash the whole run
        sys.stderr.write((e.stdout or "") + (e.stderr or ""))
        return
    # Optionally, could parse cp.stdout for additional signals.


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description="Download EN subtitles and chapters using yt-dlp")
    parser.add_argument("urls", nargs="+", help="YouTube video URLs")
    parser.add_argument("--lang", default="en.*", help="Subtitle language selector passed to yt-dlp --sub-langs (default: en.*)")
    parser.add_argument("--out", default=None, help="Custom output base directory (default: scripts/youtube_dl_tools/downloads)")
    args = parser.parse_args(argv)

    ensure_yt_dlp_available()

    base_dir = Path(args.out) if args.out else Path(__file__).resolve().parent / "downloads"
    base_dir.mkdir(parents=True, exist_ok=True)

    overall_ok = True
    for url in args.urls:
        try:
            info = fetch_info_json(url)
        except Exception:
            overall_ok = False
            continue

        video_id = info.get("id") or "unknown"
        dest = base_dir / video_id
        try:
            # Save info.json for the video
            dest.mkdir(parents=True, exist_ok=True)
            (dest / "info.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")

            # Download subtitles (manual + auto) in VTT format
            download_subtitles(url, dest, args.lang)

            # Print chapter summary to stdout
            print(f"\n== {video_id} ==")
            print_chapters(info)

            # Show any .vtt files we just saved
            vtts = sorted(str(p.name) for p in dest.glob("*.vtt"))
            print("Subtitle files:")
            if vtts:
                for name in vtts:
                    print(f" - {name}")
            else:
                print(" - (none)")
            print(f"Saved to: {dest}")
        except Exception as e:
            sys.stderr.write(f"Error processing {url}: {e}\n")
            overall_ok = False

    return 0 if overall_ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

