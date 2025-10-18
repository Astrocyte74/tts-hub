# v0.2.0-wg — WireGuard Mode + API Footer

Date: 2025-10-18

This release makes WireGuard the first‑class path for remote/NAS clients and surfaces peer‑reachable URLs across the launcher, backend, and UI.

Highlights
- WireGuard‑aware launcher
  - `WG_MODE=auto|bind-wg|bind-all|off`
  - Detects WG/LAN IPs; binds appropriately and exports `PUBLIC_HOST` and `LAN_IP`
  - Prints Local/LAN/WG URLs and a Docker test tip
- Backend URL hints
  - `/api/meta` includes `bind_host`, `public_host`, `lan_ip`, and `urls.local|bind|lan|wg`
- UI “API & CLI” footer
  - Collapsible panel shows the active API base and Local/LAN/WG URLs
  - Copyable curl examples and CLI usage (with `TTSHUB_API_BASE`)
- Documentation
  - New `docs/WIREGUARD_MODE.md` with quick starts and Docker examples

Quick start
- Dev:
  ```sh
  WG_MODE=auto ./Start\ Kokoro\ Playground\ (XTTS\ Server).command
  ```
- Prod:
  ```sh
  WG_MODE=auto KOKORO_MODE=prod ./Start\ Kokoro\ Playground\ (XTTS\ Server).command
  ```
- From a NAS/peer (Docker):
  ```sh
  docker run --rm --network host \
    -e TTSHUB_API_BASE=http://<WG_IP_OF_MAC>:7860/api \
    --entrypoint /bin/sh curlimages/curl:8.10.1 -lc 'curl -sS "$TTSHUB_API_BASE/meta"'
  ```

Environment summary
- `WG_MODE` — auto/bind-wg/bind-all/off
- `PUBLIC_HOST` — peer-visible host shown in URLs (optional)
- `BACKEND_HOST`, `VITE_HOST` — still respected when explicitly set
- `TTSHUB_API_BASE` — client/CLI base URL (use WG IP, e.g. `http://10.0.4.2:7860/api`)

Notes
- No breaking changes. Localhost continues to work. WireGuard avoids LAN client isolation and works from anywhere your Mac is online.

