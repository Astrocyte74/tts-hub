# AGENTS — Kokoro UI (CodexB)

This document orients future agents working on the CodexB branch so you can ship changes quickly and safely.

## TL;DR
- Worktree: this folder is a Git worktree on branch `ui-redesign-codexB`.
- Dev: `./Start\ Kokoro\ Playground\ (XTTS Server).command` (reuses backend if already running). UI on 5175.
- Shared models are auto‑reused from `../kokoro_twvv/models` — no large downloads.
- Two UIs concurrently: start backend in one worktree, in the other use `SKIP_BACKEND=1`.
- Status summary prints on startup; drawer auto-opens for bulk actions.

## Repo Layout (worktree)
- `backend/` — Flask API and routes for synthesis, auditions, previews.
- `frontend/` — React + Vite SPA.
  - `src/App.tsx` — app shell, state wiring, queue + dialogs.
  - `src/components/` — UI building blocks (see map below).
  - `src/api/client.ts` — fetch helpers (typed), URL construction.
  - `src/hooks/` — local/session storage hooks.
- `out/` — generated audio; previews under `out/voice_previews/`.

## Component Map (frontend)
- `TopContextBar.tsx` — header with engine, voice summary, Results chip (includes live queue badge), Quick Generate.
- `TextWorkbench.tsx` — script editor with SSML chips and counters.
- `SynthesisControls.tsx` — engine/language/speed/trim + engine‑specific controls.
- `AnnouncerControls.tsx` — announcer template/voice.
- `SynthesisActions.tsx` — Generate and Audition buttons.
- `VoiceSelector.tsx` — voice cards, search, facet chips, favorites, preview chip, and bulk “Generate previews”.
- `ResultsDrawer.tsx` — bottom dock with Queue/History (optimistic progress + persistence).
- `AudioResultCard.tsx` — clip card; includes `WaveformPlayer` and `WaveformTrim` (loop/trim/export WAV).
- `SettingsPopover.tsx`, `InfoDialog.tsx`, `FavoritesManagerDialog.tsx`, `PresetDialog.tsx` — overlays/dialogs.

## Data & State
- API access via `src/api/client.ts`. `VITE_API_BASE_URL` and `VITE_API_PREFIX` govern API origin/prefix.
- Async state: React Query (`useQuery`/`useMutation`).
- Persistence: `useLocalStorage` for settings, `useSessionStorage` for queue/history.
- Queue items are `{ id, label, engine, status, progress?, startedAt?, finishedAt?, error? }`.

## Preview Generation (Phase 3)
- Endpoint: `POST /api/voices/preview { engine, voiceId, language?, force? }` (Kokoro implemented).
- Caching: `out/voice_previews/<engine>/<voiceId>-<language>-v1.wav`.
- UI: per‑card “Generate preview” chip; bulk action button for filtered voices; queue reflects progress.
- Hover + “Preview” chip call a shared audio element; relative URLs are prefixed with `VITE_API_BASE_URL` to reach the backend.
- To extend to another engine, implement an engine‑specific `_get_or_create_<engine>_preview()` helper and wire the route to dispatch by `engine`.

## Adding Features — Playbook
1) API change (if needed)
   - Add helper + route in `backend/app.py` (keep errors as `PlaygroundError`).
   - Expose via `src/api/client.ts` with a typed function.
2) UI change
   - Add/extend a component under `src/components/`.
   - Thread props from `App.tsx` minimally; update styles in `App.css`.
   - Use session/local storage hooks for small persistent state.
3) Queue integration
   - Enqueue items in `App.tsx`; auto‑open Results drawer; set optimistic progress; mark done/error.
4) A11y
   - Use `role=list`/`listitem` for lists; label interactive elements (`aria-label`, `aria-pressed`).
5) Docs
   - Update `DESIGN.md` and `README.md` sections relevant to the change.

## Coding Conventions
- Prefer small, pure helpers in components; avoid global singletons except for shared audio element.
- Keep props explicit; prefer composition over deep prop drilling.
- TS: avoid `any` (except in guarded interop); narrow types with runtime checks where needed.
- CSS: add minimal selectors to `App.css` following the existing naming pattern (e.g., `.topbar__…`, `.voice-card__…`).
- Errors: surface user‑facing errors in the banner via `setError`, keep logs quiet on happy path.

## Common Tasks
- Run UI only against an existing backend:
  - `SKIP_BACKEND=1 ./Start\ Kokoro\ Playground\ (XTTS Server).command`
- Change ports:
  - UI defaults (worktree): A=5174, B=5175; backend defaults 7860.
- Ensure previews fetch from backend in dev:
  - Set `VITE_API_BASE_URL=http://127.0.0.1:7860` if running UI-only.

## Known Limitations
- Queue cancel is a stub (UI-only); server jobs are short and not cancelable yet.
- Previews currently implemented for Kokoro; other engines need parity when we add them.

## Contact Points / Quick Links
- API routes overview: `API_ROUTES.md` (repo root)
- Phase 2 summary + a11y notes: `DESIGN.md`
- Worktrees usage: `../WORKTREES.md` and `README_WORKTREE.md`
