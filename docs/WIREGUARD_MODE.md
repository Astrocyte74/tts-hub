# WireGuard Mode for Kokoro Playground

This launcher can auto-detect a WireGuard interface and advertise URLs that your peers (e.g., a NAS) can reach, while keeping localhost working on your Mac.

Use cases
- Access the API/UI securely from any location over your WireGuard tunnel.
- Let other devices/scripts (NAS, servers) call the Favorites API and `/synthesise`.

How it works
- The launcher looks for a WireGuard-style interface (`wg*`, `utun*`, or `tun*`) and captures its IPv4.
- Depending on `WG_MODE`, it selects where the backend binds and what URL is shown to peers.

Environment variables
- `WG_MODE` (default `auto`):
  - `auto`     — Bind backend to `0.0.0.0` (LAN + WG) and advertise the detected WG IP.
  - `bind-wg`  — Bind backend only to the WG IP (VPN‑only exposure; localhost will not work).
  - `bind-all` — Bind backend to `0.0.0.0` (same as `auto` but forces behavior without detection).
  - `off`      — Disable WireGuard handling.
- `PUBLIC_HOST` (optional): Override the host shown in status lines and used by the dev UI for API calls.
- `KOKORO_MODE`: `dev` (default) or `prod`. In `prod`, Flask serves both API and built UI on one port.
- `BACKEND_HOST`: Explicit bind host (overrides WG_MODE binding if set).
- `VITE_HOST`: Dev UI bind host (defaults to `0.0.0.0` when WG mode is active).

Quick start
- Dev UI + API (LAN + WG, localhost still works):
  ```sh
  cd kokoro_twvv
  WG_MODE=auto ./Start\ Kokoro\ Playground\ (XTTS\ Server).command
  ```
  Watch the status lines for URLs (Local/LAN/WG).

- Prod (single port, UI+API via Flask):
  ```sh
  WG_MODE=auto KOKORO_MODE=prod ./Start\ Kokoro\ Playground\ (XTTS\ Server).command
  ```

- VPN‑only binding (no LAN, no localhost):
  ```sh
  WG_MODE=bind-wg KOKORO_MODE=prod ./Start\ Kokoro\ Playground\ (XTTS\ Server).command
  ```

Remote usage examples (from a peer)
- Favorites list: `curl http://<WG_IP_OF_MAC>:7860/api/favorites`
- Synth by slug: `curl -X POST -H 'Content-Type: application/json' \
  -d '{"favoriteSlug":"my-voice","text":"Hello"}' http://<WG_IP_OF_MAC>:7860/api/synthesise`

Docker examples (NAS or server)
- One‑off test:
  ```sh
  docker run --rm --network host \
    -e TTSHUB_API_BASE=http://<WG_IP_OF_MAC>:7860/api \
    --entrypoint /bin/sh curlimages/curl:8.10.1 -lc 'curl -sS "$TTSHUB_API_BASE/meta"'
  ```
- docker-compose service:
  ```yaml
  services:
    kokoro-client:
      image: curlimages/curl:8.10.1
      network_mode: host
      environment:
        TTSHUB_API_BASE: http://<WG_IP_OF_MAC>:7860/api
      entrypoint: ["/bin/sh","-lc","curl -sS \"$TTSHUB_API_BASE/meta\" && echo"]
  ```

Security
- Set `FAVORITES_API_KEY` on the server to require `Authorization: Bearer <key>` for all `/favorites` routes.
- CORS is open for the API by default; use the API key if exposing to untrusted peers.

Troubleshooting
- macOS firewall: allow incoming connections for Python/Node when prompted.
- Ensure your peer’s WireGuard config includes your Mac’s WG IP under `AllowedIPs`.
- Verify listening: `lsof -i :7860` on the Mac.
- Health check: `curl http://<WG_IP>:7860/api/meta`.

Notes
- In dev mode, the UI (Vite) binds to `VITE_HOST` and calls the API at `PUBLIC_HOST` (if set) to ensure remote peers can reach it.
- XTTS server remains local; the backend proxies/coordinates with it. You typically do not need to expose XTTS over WG.
