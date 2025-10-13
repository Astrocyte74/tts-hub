# Worktree: kokoroB (ui-redesign-codexB)

This folder is a Git worktree that checks out the branch `ui-redesign-codexB` from the repository in `../kokoro_twvv`.

Quick start
- Dev UI: `cd frontend && npm run dev -- --port 5174`
- Optional API base (if UI runs on a different port/host): set `VITE_API_BASE_URL` in `.env`.

Good to know
- Changes here commit to the branch `ui-redesign-codexB` only.
- Do not switch branches in this folder; use `kokoroA` for the other branch.
- To remove this worktree safely: `cd ../kokoro_twvv && git worktree remove ../kokoroB`
- The real Git data lives in `../kokoro_twvv/.git` (this folder contains a pointer file).

Compare branches side‑by‑side
- Run this UI on `5174` and the other worktree (`kokoroA`) on `5173`.
- Point both at the same backend or run separate backends as needed.
