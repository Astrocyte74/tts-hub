# YouTube Cookies for yt-dlp (Handling 429 and Age/Consent)

When importing XTTS custom voices from YouTube, the server invokes `yt-dlp` to fetch audio. Public unauthenticated requests can intermittently hit 429 (rate limits) or age/consent gates. The recommended workaround is to provide a browser cookies file in Netscape format.

## TL;DR

1. Export cookies on your Mac:
   - Easiest: `yt-dlp --cookies-from-browser chrome -o cookies.txt` (or `safari`, `firefox`, etc.)
   - Or use a cookies.txt browser extension, but verify the file works (see step 2).
2. Test locally:
   - `yt-dlp --cookies cookies.txt "https://www.youtube.com/watch?v=XXXX" --skip-download -v`
   - If yt-dlp resolves formats without 429, your cookie is good.
3. Copy cookies.txt to the NAS and point the hub to it (or use the default path):
   - Default path: `~/.kokoro/yt_cookies.txt`
   - Env override (optional): `YT_DLP_COOKIES_PATH=/path/to/cookies.txt`
4. Restart the hub. YouTube imports will use the cookie and gentle retries by default.

## Server Behavior

- The hub checks `YT_DLP_COOKIES_PATH` (default `~/.kokoro/yt_cookies.txt`). If present, the server runs:
  - `yt-dlp --cookies <file> --sleep-requests 1 --retry-sleep 2 --retries 3 -f bestaudio/best ...`
- Optional: you may pass additional extractor args via `YT_DLP_EXTRACTOR_ARGS`, e.g.:
  - `youtube:player_client=web`
  - `youtube:po_token=ios.gvs+XXX` (advanced; see yt-dlp PO Token guide)

## Notes

- Cookies are sensitive (act like a password). Store them only on trusted servers, with permissions `0600`.
- The Netscape format is required. `yt-dlp --cookies-from-browser` generates compatible cookies directly from your local browser.
- If a file from an extension doesn’t work, re-export with `yt-dlp --cookies-from-browser` and re-test as shown above.

## Roadmap

- Web UI will add a small “YouTube Cookie” manager to upload/replace/remove cookies.txt securely (admin-only), and show last-updated status.
