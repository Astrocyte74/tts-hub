#!/usr/bin/env python3
"""
create_youtube_cookies.py

Open a temporary Chrome (or other browser) profile, let you sign in, then export
cookies in Netscape format using yt-dlp's --cookies-from-browser support and
write them to a cookies.txt file you can copy to the server (or use locally).

Example:
  python3 cli/create_youtube_cookies.py \
    --url "https://www.youtube.com/watch?v=dQw4w9WgXcQ" \
    --cookies-out ~/.kokoro/yt_cookies.txt

Notes
- Requires yt-dlp in PATH. Install with: python3 -m pip install -U yt-dlp
- On macOS, this script launches Google Chrome via 'open'. On other platforms,
  it prints an equivalent manual command you can run.
- The generated cookies file is sensitive; treat it like a password. Default
  destination (~/.kokoro/yt_cookies.txt) matches the hub's YT_DLP_COOKIES_PATH.
"""

from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path
from tempfile import TemporaryDirectory


def which(cmd: str) -> str | None:
    return shutil.which(cmd)


def run(cmd: list[str], *, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess | str:
    print(">", " ".join(cmd))
    if capture:
        return subprocess.run(cmd, check=check, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True).stdout  # type: ignore[return-value]
    return subprocess.run(cmd, check=check)


def ensure_yt_dlp() -> None:
    if not which("yt-dlp"):
        print("yt-dlp not found on PATH. Install with: python3 -m pip install -U yt-dlp", file=sys.stderr)
        sys.exit(1)
    try:
        out = run(["yt-dlp", "--version"], capture=True)
        print("yt-dlp version:", out.strip())
    except Exception as exc:
        print("Failed to run yt-dlp --version:", exc, file=sys.stderr)
        sys.exit(1)


def wait_for_enter(timeout: int) -> None:
    def _handler(signum, frame):  # noqa: ARG001
        raise TimeoutError("Timeout waiting for user input")

    if hasattr(signal, "SIGALRM"):
        signal.signal(signal.SIGALRM, _handler)  # type: ignore[arg-type]
        signal.alarm(timeout)
    try:
        input("\nWhen you've signed in and are ready to extract cookies, press ENTER…")
    finally:
        if hasattr(signal, "SIGALRM"):
            signal.alarm(0)


def macos_open_chrome(user_data_dir: str, url: str) -> None:
    # Launch Chrome with a temporary user profile and the target URL
    try:
        run(["open", "-na", "Google Chrome", "--args", f"--user-data-dir={user_data_dir}", url])
    except Exception as exc:
        print("Failed to launch Chrome via 'open':", exc, file=sys.stderr)
        print("You can launch it manually with:")
        print(f'  Google Chrome --user-data-dir="{user_data_dir}" "{url}"')
        raise


def export_cookies_from_browser(browser: str, profile_dir: str, url: str, cookies_out: str) -> None:
    # Use yt-dlp to export cookies from the temporary browser profile and probe subs (network request)
    cmd = [
        "yt-dlp",
        "--cookies-from-browser",
        f"{browser}:{profile_dir}",
        "--cookies",
        cookies_out,
        "--sleep-requests",
        "1",
        "--retry-sleep",
        "2",
        "--retries",
        "3",
        "--skip-download",
        "--list-subs",
        url,
    ]
    try:
        out = run(cmd, capture=True)
        print("\n--- yt-dlp output start ---\n")
        print(out)
        print("\n--- yt-dlp output end ---\n")
    except subprocess.CalledProcessError as exc:  # pragma: no cover
        print("yt-dlp failed. Output:")
        if getattr(exc, "output", None):
            print(exc.output)
        else:
            print(exc)


def verify_cookies(url: str, cookies_out: str) -> bool:
    # Quick probe using the cookies file to ensure it parses and requests work
    cmd = [
        "yt-dlp",
        "--cookies",
        cookies_out,
        "--skip-download",
        "-v",
        url,
    ]
    try:
        out = run(cmd, capture=True)
        print("\n--- yt-dlp verify output (truncated) ---\n")
        print("\n".join(out.splitlines()[:40]))
        print("\n--- end ---\n")
        return True
    except subprocess.CalledProcessError as exc:  # pragma: no cover
        print("Verification failed:")
        if getattr(exc, "output", None):
            print(exc.output)
        return False


def main() -> None:
    ap = argparse.ArgumentParser(description="Open temp browser profile and export YouTube cookies via yt-dlp")
    ap.add_argument("--url", default="https://www.youtube.com/watch?v=dQw4w9WgXcQ", help="YouTube URL used for cookie probe (default: Rickroll)")
    ap.add_argument("--cookies-out", default=str(Path.home() / ".kokoro" / "yt_cookies.txt"), help="Path to write Netscape cookies.txt (default: ~/.kokoro/yt_cookies.txt)")
    ap.add_argument("--browser", default="chrome", choices=["chrome", "firefox", "edge", "safari"], help="Browser to export cookies from (default: chrome)")
    ap.add_argument("--timeout", type=int, default=600, help="Timeout in seconds waiting for login (default 600)")
    ap.add_argument("--no-clean", action="store_true", help="Retain the temporary profile directory on disk")
    args = ap.parse_args()

    ensure_yt_dlp()

    cookies_out = os.path.expanduser(args.cookies_out)
    Path(cookies_out).parent.mkdir(parents=True, exist_ok=True)

    with TemporaryDirectory(prefix="chrome-temp-") as tmpdir:
        profile_dir = os.path.abspath(tmpdir)
        print("Temporary user-data-dir:", profile_dir)

        if sys.platform == "darwin":
            macos_open_chrome(profile_dir, args.url)
        else:
            print("\nNon-macOS detected. Launch your browser manually with:")
            if args.browser == "chrome":
                print(f'  google-chrome --user-data-dir="{profile_dir}" "{args.url}"')
            elif args.browser == "firefox":
                print(f'  firefox --profile "{profile_dir}" "{args.url}"')
            elif args.browser == "edge":
                print(f'  microsoft-edge --user-data-dir="{profile_dir}" "{args.url}"')
            else:
                print("  (Safari automation not supported; use Chrome/Firefox/Edge)")

        print("\nSign in with the account you want the cookie for (secondary account is recommended).")
        print(f"Timeout: {args.timeout}s.")
        try:
            wait_for_enter(args.timeout)
        except TimeoutError:
            print("Timed out waiting for login. Exiting.")
            if args.no_clean:
                print("Temp profile retained at:", profile_dir)
            return

        export_cookies_from_browser(args.browser, profile_dir, args.url, cookies_out)

        if os.path.exists(cookies_out):
            os.chmod(cookies_out, 0o600)
            print("\nCookies saved to:", os.path.abspath(cookies_out))
            ok = verify_cookies(args.url, cookies_out)
            if ok:
                print("Verification succeeded. You can copy this file to the NAS and set YT_DLP_COOKIES_PATH.")
        else:
            print("\nCookies file not found at expected path:", cookies_out)

        if args.no_clean:
            print("Temp profile retained at:", profile_dir)
            print("Remove it manually with: rm -rf", profile_dir)
        else:
            # TemporaryDirectory cleans up automatically
            pass


if __name__ == "__main__":
    main()

