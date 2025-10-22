# Onboarding — Kokoro Playground Hub (Codex Quick Start)

Welcome. This repo powers the local TTS hub (Flask API + SPA) you’ve been using from the NAS/bots. This page is the fastest way to get productive in a new Codex session.




## Where to Work
- Use this directory as your working root: `~/projects/tts-hub/kokoro_twvv`
- This folder is the real Git repo (remote = `origin`). The top‑level `~/projects/tts-hub` is just a worktree wrapper — do not open Codex there.

## Git Workflow
- Default: commit and push directly to `main` (keep commits focused and self‑contained).
- Optional: use feature branches and PRs if you want review/history: `git checkout -b feature/<topic>` → `git push -u origin feature/<topic>`.
- Update local `main` after pushes:
  - `git checkout main && git pull --ff-only`
  - If local `main` diverged: `git branch backup/local-main-<ts>; git reset --hard origin/main`

## Launch (Dev/Prod) + Power Behavior
- One‑liner (prod, keeps system awake while screen sleeps):
  - `KEEP_AWAKE=1 WG_MODE=auto KOKORO_MODE=prod ./Start\ Kokoro\ Playground\ (XTTS\ Server).command`
- Key envs:
  - `WG_MODE=auto|bind-wg|bind-all|off` (WireGuard auto‑detection & bind)
  - `KEEP_AWAKE=1` (re‑exec under `caffeinate -ims`; display may sleep; network stays up)
  - `OLLAMA_URL` (default `http://127.0.0.1:11434`)
  - `TTSHUB_API_KEY` (optional; auth only for /favorites)

## API Base + Quick Checks (from a peer)
- Set base: `export HUB=http://<WG_IP_OF_MAC>:7860; export API=$HUB/api`
- Favorites:
  - `curl -sS "$API/favorites" | jq '.profiles[] | {label,engine,voiceId,slug,id,tags}'`
- Voices catalog + filters:
  - `curl -sS "$API/voices_catalog?engine=kokoro" | jq '.filters, .voices[0]'`
- Synthesise by favorite:
  - `curl -sS -X POST "$API/synthesise" -H 'Content-Type: application/json' -d '{"text":"Hi","favoriteSlug":"favorite--af-heart"}' | jq`
- Synthesise by voice:
  - `curl -sS -X POST "$API/synthesise" -H 'Content-Type: application/json' -d '{"text":"Hi","engine":"kokoro","voice":"af_heart"}' | jq`

## Ollama Proxy (LLM over the same port)
- List models: `curl -sS "$API/ollama/tags" | jq`
- Pull (SSE): `curl -N -sS -X POST "$API/ollama/pull" -H 'Content-Type: application/json' -d '{"model":"tinyllama:latest","stream":true}'`
- Generate (JSON): `curl -sS -X POST "$API/ollama/generate" -H 'Content-Type: application/json' -d '{"model":"phi3:latest","prompt":"Say hi","stream":false}' | jq`
- Chat (SSE): `curl -N -sS -X POST "$API/ollama/chat" -H 'Content-Type: application/json' -d '{"model":"phi3:latest","messages":[{"role":"user","content":"Stream one line"}],"stream":true}'`
- Delete model (normalized): `curl -sS "$API/ollama/delete?model=phi3:latest" | jq`

## Persona / Voice Selection (for bots)
- Use “selectors” consistently:
  - Favorite: `fav:<slug>` (e.g., `fav:favorite--cleopatra`)
  - VoiceId: `voice:<id>` or `<id>@<engine>` (e.g., `af_heart@kokoro`)
  - Plain favorite label also works if unique.
- Hub bodies:
  - Favorite: `{ "text":"...","favoriteSlug":"fav--slug" }`
  - Voice: `{ "text":"...","engine":"kokoro","voice":"af_heart" }`
- Metadata for filtering comes from `GET /api/voices_catalog`: gender, locale, accent, plus `accentFamilies` (any/female/male).

## Troubleshooting
- 400 from `/synthesise`:
  - Missing `text`, neither favorite nor (engine+voice), or bad favorite/voice. Print response body for the exact message.
- SSE “no output”: you should see `{"status":"starting"}` immediately; progress follows when upstream emits. Try a tiny model first.
- Favorites 401: set `TTSHUB_API_KEY` on the hub and send `Authorization: Bearer <key>` from the client for /favorites routes.
- Ports busy: launcher will report and pick a free dev port; backend is `:7860`.
- Keep‑awake: launcher prints a “Power: keep‑awake…” line; set `KEEP_AWAKE=1` to enable.

## Common Files
- Launcher: `Start Kokoro Playground (XTTS Server).command`
- Backend: `backend/app.py`
- Frontend: `frontend/`
- Docs: `README.md`, `API_ROUTES.md`, `docs/WIREGUARD_MODE.md`, `CHANGELOG.md`
- Release notes: `RELEASE_NOTES_v*.md`

## Conventions
- Keep diffs surgical; don’t reformat unrelated code.
- Prefer favorites slugs or `voiceId@engine` in examples.
- Cache `/favorites` and `/voices_catalog` for 1–5 minutes if your code does repeated lookups.
- Log hub 4xx text (don’t retry schema errors).


##NEXT DOCS TO READ
  - README.md — overview + Ollama proxy section.
  - API_ROUTES.md — exact endpoints and payloads (synthesise, favorites, voices_catalog, ollama/*).
  - docs/WIREGUARD_MODE.md — how URLs resolve over WG + peer testing.
  - AGENTS.md — component map and quick start checklist (same as onboarding, in brief).
  - CONTRIBUTING.md — simplified git workflow (direct pushes to main).
  
  
