# Changelog

All notable changes to this project will be documented here.

## [v0.2.0-wg] – 2025-10-18

Highlights
- WireGuard‑aware launcher
  - New `WG_MODE` with `auto` (default), `bind-wg`, `bind-all`, `off`.
  - Detects WireGuard/LAN IPs; binds appropriately and exports `PUBLIC_HOST`/`LAN_IP`.
  - Prints Local/LAN/WG URLs and a ready‑to‑copy Docker test.
- Backend URL hints
  - `/api/meta` now includes `urls.local|bind|lan|wg` plus `bind_host`, `public_host`, and `lan_ip`.
- UI “API & CLI” footer
  - Collapsible panel shows active API base and peer‑reachable URLs (Local/LAN/WG) with curl + CLI snippets.
  - Header “API” button scrolls to the panel.
- Documentation
  - New `docs/WIREGUARD_MODE.md` with quick starts and Docker examples.

Notes
- No breaking changes; localhost continues to work. WireGuard is now the recommended path for remote/NAS clients.
- LAN isolation on some routers may still block direct 192.168.x.x access; the WG endpoint avoids that entirely.

## [UI revamp] – 2025-10-14

Highlights
- Segmented modes: Script | Engine | Voice | Clips with active styling and hotkeys (1=Script, 2=Voice, 3=Engine, 4=Clips; G=Create clip; V=Voices; R=Clips; S=Settings; Shift+/?=AI Assist).
- Engine selection cards with strengths + overview; accessible fallback select retained off-screen.
- Quick settings: “Auto preview on hover” and “Auto open Clips on completion” toggles (both default on; persisted to localStorage).
- Queue → Clips flow: Queue tab shows only active items with a live count; auto-switch to Clips when queue becomes empty and results exist; newest clip highlight.
- Voice quick menu: caret on the Voice segment opens Favorites (up to 5) and Recent (up to 5); selecting a voice returns to Script.
- Script header: AI Assist pill shows Ready/Offline based on `/meta` `ollama_available`.

Notes
- “History” renamed to “Clips” across the UI and docs.
- Drawer is hidden entirely when in the Clips segment; otherwise shown and toggleable.

## [ui-v2-beta] – 2025-10-13

Highlights
- Modernized Kokoro UI (Codex B) merged to `main` (merge commit 793b5fa) and tagged `ui-v2-beta`.
- Voice Browser 2.0
  - Hover micro‑preview on cards (plays cached sample when present)
  - Favorites with pinned row (local persistence)
  - Facet chips for Language / Gender / Style with live counts and multi‑select
  - Header action to bulk-generate missing previews for the filtered set
- Script Authoring
  - SSML helper chips (Pause, Emphasis, Pitch, Rate)
  - Live counters for words/characters and duration estimate
  - Basic SSML validation (balanced tags)
- Queue & Results
  - Bottom drawer with Queue | History tabs
  - Optimistic progress + session persistence across reloads
  - Mini waveform with Loop + Start/End sliders and Export selection (WAV)
  - Top bar Clips chip shows a live queue badge (running/total)
- Preview Generation (Phase 3 – Kokoro)
  - Endpoint `POST /api/voices/preview { engine, voiceId, language?, force? }`
  - Cached short previews in `out/voice_previews/kokoro/` (trim + normalize + fade)
  - Per‑card “Generate preview” chip and bulk action for filtered sets
- Dev Experience
  - Launchers auto‑reuse shared models from `../kokoro_twvv/models`
  - `SKIP_BACKEND=1` to run UI‑only (dev), and `TAKE_OVER=1` for XTTS restart
  - Status summary at startup and dev port auto‑pick
  - New docs: `AGENTS.md`, `API_ROUTES.md`, and unified `DESIGN.md`

Breaking changes
- None expected; existing launcher workflows continue to function. The UI adds new panels and actions but remains single‑page.

Upgrade notes
- Ensure `.env` (or `.env.local`) points to your backend if you run UI-only; set `VITE_API_BASE_URL=http://127.0.0.1:7860`.
- The output directory `out/` and subfolder `out/voice_previews/` are ignored by Git.
## [Favorites as presets] – 2025-10-15

Highlights
- Favorites unified as presets usable from UI and scripts; notes supported and preserved in import/export.
- Star/Unstar writes to `/api/favorites` with engine + voice + params (language/speed/trim; style/seed per engine).
- Quick select (Voice caret) shows Favorites first with Edit/Delete/Manage; reliable interactions and hover/focus polish.
- Favorites section (Voices) is collapsible and uses a compact list with param summary and notes preview; actions on the right.
- Favorites Manager dialog added for list/filter/edit/delete/import/export. Import/Export moved here.

API
- `/api/synthesise` accepts `favoriteId`/`favoriteSlug` (existing `profileId`/`profileSlug` still accepted as aliases).

Notes
- Removed top‑bar “Save favorite”; starring is the single save gesture.
