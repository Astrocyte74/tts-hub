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

def kill_profile_processes(profile_dir: str) -> None:
    # Best-effort: kill the Chrome instance started with this --user-data-dir only
    try:
        if sys.platform == "darwin":
            # macOS: match the temp profile; tolerate absence
            run(["bash", "-lc", f"pgrep -fl 'Google Chrome.*--user-data-dir={profile_dir}' || true"], capture=True)
            run(["bash", "-lc", f"pkill -f 'Google Chrome.*--user-data-dir={profile_dir}'"], check=False)
        else:
            # Linux: try pkill by profile dir arg
            run(["pkill", "-f", profile_dir], check=False)
    except Exception:
        # Non-fatal; directory cleanup may still succeed
        pass


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
    ap.add_argument("--secondary-dir", default="/Volumes/Docker/YTV2/data/cookies", help="Optional secondary directory to also write cookies (if mounted). Set to empty string to disable.")
    ap.add_argument("--secondary-name", default="cookies.txt", help="Filename to use for the secondary copy (default: cookies.txt)")
    ap.add_argument("--non-interactive-secondary", action="store_true", help="If secondary dir is unavailable, do not prompt to retry; just print copy instructions.")
    args = ap.parse_args()

    ensure_yt_dlp()

    cookies_out = os.path.expanduser(args.cookies_out)
    Path(cookies_out).parent.mkdir(parents=True, exist_ok=True)

    # Manage temp dir manually so we can suppress cleanup errors on 3.10
    tmpdir_obj = TemporaryDirectory(prefix="chrome-temp-")
    try:
        profile_dir = os.path.abspath(tmpdir_obj.name)
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
            print("\nPrimary cookies saved to:", os.path.abspath(cookies_out))
            ok = verify_cookies(args.url, cookies_out)
            if ok:
                print("Verification succeeded.")
        else:
            print("\nCookies file not found at expected path:", cookies_out)

        # Mirror to secondary location if available/mounted
        def _mirror_secondary() -> None:
            sec_dir = (args.secondary_dir or "").strip()
            if not sec_dir:
                return
            dest = os.path.join(sec_dir, args.secondary_name or "cookies.txt")
            if os.path.isdir(sec_dir) and os.access(sec_dir, os.W_OK):
                try:
                    import shutil as _sh
                    _sh.copy2(cookies_out, dest)
                    try:
                        os.chmod(dest, 0o600)
                    except Exception:
                        pass
                    print(f"Secondary copy written: {dest}")
                except Exception as exc:
                    print(f"Warning: failed to write secondary copy to {dest}: {exc}")
            else:
                print(f"Secondary cookies dir not available: {sec_dir}")
                print("If this volume should be mounted, mount it and ")
                print(f"then copy with: cp '{os.path.abspath(cookies_out)}' '{dest}'")
                if not args.non_interactive_secondary:
                    try:
                        ans = input("\nMount now and press ENTER to retry copying (or type 'skip'): ").strip().lower()
                    except KeyboardInterrupt:
                        ans = "skip"
                    if ans != "skip":
                        if os.path.isdir(sec_dir) and os.access(sec_dir, os.W_OK):
                            try:
                                import shutil as _sh
                                _sh.copy2(cookies_out, dest)
                                try:
                                    os.chmod(dest, 0o600)
                                except Exception:
                                    pass
                                print(f"Secondary copy written: {dest}")
                            except Exception as exc:  # pragma: no cover
                                print(f"Failed again to write secondary copy: {exc}")
                        else:
                            print("Still not available; you can copy later using the command above.")

        if os.path.exists(cookies_out):
            _mirror_secondary()

        # Attempt to close the temp Chrome instance to allow cleanup
        kill_profile_processes(profile_dir)
        time.sleep(0.5)  # give Chrome a moment to release locks
    finally:
        if args.no_clean:
            print("Temp profile retained at:", os.path.abspath(tmpdir_obj.name))
            print("Remove it manually with: rm -rf", os.path.abspath(tmpdir_obj.name))
        else:
            # Suppress cleanup errors if Chrome still holds some files
            try:
                tmpdir_obj.cleanup()
            except Exception:
                pass


if __name__ == "__main__":
    main()
