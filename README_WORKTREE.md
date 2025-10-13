# Worktree: kokoroB (ui-redesign-codexB)

This folder is a Git worktree that checks out the branch `ui-redesign-codexB` from the repository in `../kokoro_twvv`.

Quick start
- Dev UI: `cd frontend && npm run dev:b`
- Optional API base (if UI runs on a different port/host): set `VITE_API_BASE_URL` in `.env`.

Good to know
- Changes here commit to the branch `ui-redesign-codexB` only.
- Do not switch branches in this folder; use `kokoroA` for the other branch.
- To remove this worktree safely: `cd ../kokoro_twvv && git worktree remove ../kokoroB`
- The real Git data lives in `../kokoro_twvv/.git` (this folder contains a pointer file).

Compare branches side‑by‑side
- Run this UI on `5175` and the other worktree (`kokoroA`) on `5174`.
- Point both at the same backend or run separate backends as needed.

Concurrent frontends (one backend)
- Start backend once in either worktree using the launcher (no flags).
- In the other worktree, run UI‑only by setting `SKIP_BACKEND=1`:
  - `SKIP_BACKEND=1 ./Start Kokoro Playground (XTTS Server).command`
  - or: `VITE_API_BASE_URL=http://127.0.0.1:7860 npm run dev:b`
