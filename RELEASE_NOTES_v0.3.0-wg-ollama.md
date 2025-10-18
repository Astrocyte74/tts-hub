# v0.3.0-wg-ollama — Ollama Proxy + SSE + UI panel

Date: 2025-10-18

This milestone makes the hub a single entry point for TTS and LLM. Ollama is proxied through the hub (with streaming), plus a small UI panel for models/status/pulls.

What’s new
- Ollama proxy endpoints
  - `GET /api/ollama/tags` — installed models
  - `POST /api/ollama/generate` — `{ model, prompt, stream? }` (SSE or JSON)
  - `POST /api/ollama/chat` — `{ model, messages[], stream? }` (SSE or JSON)
  - `POST /api/ollama/pull` — `{ model, stream? }` (SSE progress or JSON)
  - `GET /api/ollama/ps` — runtime status
  - `GET|POST /api/ollama/show` — model details
  - `GET|POST /api/ollama/delete` — remove model; returns 200 for “already missing”; strips ANSI
- Streaming UX
  - All SSE endpoints emit an initial `{"status":"starting"}` for instant liveness
- UI
  - “Ollama” panel under the API footer: list models, view status, pull models (streaming log), quick generate
- Catalogue filters
  - `GET /api/voices_catalog` returns voices + filters (genders, locales, accents, accentFamilies) and engines meta
  - Kokoro voices include `engine` and derived `gender`
- Accent labels
  - Compact labels (USA/UK/Other) with flags

Quick tests
```
export TTSHUB_API_BASE=http://<WG_IP_OF_MAC>:7860/api
curl -sS "$TTSHUB_API_BASE/ollama/tags" | jq
curl -N -sS -X POST "$TTSHUB_API_BASE/ollama/pull" -H 'Content-Type: application/json' -d '{"model":"tinyllama:latest","stream":true}'
curl -sS -X POST "$TTSHUB_API_BASE/ollama/generate" -H 'Content-Type: application/json' -d '{"model":"phi3:latest","prompt":"Say hello","stream":false}' | jq
```

Environment
- `WG_MODE=auto|bind-wg|bind-all|off` (WireGuard discovery/binding)
- `PUBLIC_HOST`, `LAN_IP` (exported by launcher; used by UI/status)
- `OLLAMA_URL` (default `http://127.0.0.1:11434`)
- Optional: `OLLAMA_ALLOW_CLI=0|1` (allow CLI fallback for delete; default 1)

