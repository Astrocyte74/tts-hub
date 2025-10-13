# Worktree: kokoroA (feature/ui-ux-wireframe)

This folder is a Git worktree that checks out the branch `feature/ui-ux-wireframe` from the repository in `../kokoro_twvv`.

Quick start
- Dev UI: `cd frontend && npm run dev -- --port 5173`
- Optional API base (if UI runs on a different port/host): set `VITE_API_BASE_URL` in `.env`.

Good to know
- Changes here commit to the branch `feature/ui-ux-wireframe` only.
- Do not switch branches in this folder; use `kokoroB` for the other branch.
- To remove this worktree safely: `cd ../kokoro_twvv && git worktree remove ../kokoroA`
- The real Git data lives in `../kokoro_twvv/.git` (this folder contains a pointer file).

Compare branches side‑by‑side
- Run this UI on `5173` and the other worktree (`kokoroB`) on `5174`.
- Point both at the same backend or run separate backends as needed.
