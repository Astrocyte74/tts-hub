# Contributing / Dev Workflow (Codex + Humans)

This repo uses a protected `main` branch and a separate worktree for day‑to‑day development.

## Where to work
- Daily dev worktree: `/Users/markdarby/projects/tts-hub/kokoroB`
- Do not develop in: `/Users/markdarby/projects/tts-hub/kokoro_twvv` (this is the stable main worktree)

If you need your own workspace, create another worktree from `kokoro_twvv`:

```
cd /Users/markdarby/projects/tts-hub/kokoro_twvv
git worktree add ../kokoroFeature feat/<short-name>
```

## Branch model
- `main` (protected): always releasable; only merge via Pull Requests (PRs).
- Feature branches: short‑lived branches created from `origin/main`.
- Optional: `dev` exists in `kokoroB` for convenience, but prefer branching from `origin/main` per feature.

## Daily flow (copy/paste)
```
# 1) Create a feature branch from latest main
cd /Users/markdarby/projects/tts-hub/kokoroB
git fetch origin
git checkout -b feat/<short-name> origin/main

# 2) Develop, commit, push
# (make changes)
git add -A && git commit -m "feat: <short summary>"
git push -u origin feat/<short-name>

# 3) Open a PR on GitHub: base=main, compare=feat/<short-name>
#    Merge the PR once checks pass (main is protected; direct pushes are blocked).

# 4) Refresh local main
git fetch origin
git checkout main
git pull
```

## Running the app
- Full stack (backend + UI):
  ```
  ./Start\ Kokoro\ Playground\ \(XTTS\ Server\).command
  ```
- UI‑only (when another session already runs the backend):
  ```
  SKIP_BACKEND=1 ./Start\ Kokoro\ Playground\ \(XTTS\ Server\).command
  ```
- If running UI‑only, set the backend origin for the SPA:
  ```
  VITE_API_BASE_URL=http://127.0.0.1:7860 npm run dev
  ```

Ports
- UI: 5175 (the launcher will auto‑pick the next free port)
- Backend: 7860

## Previews (Kokoro)
- Per‑card “Generate preview” chip on voices without samples.
- Bulk: “Generate previews for N” in the Voices header (operates on filtered set).
- Progress is shown in the bottom Results drawer (Queue tab) and as a live badge on the top bar Clips chip.

## Docs to read first
- `AGENTS.md` — component map, state patterns, playbook
- `API_ROUTES.md` — endpoint summary and shapes
- `DESIGN.md` — UI intent, Phase 2/3 notes
- `CHANGELOG.md` — recent user‑visible changes

## Code hygiene
- Do not commit generated audio or previews — `out/` is ignored by Git.
- Keep PRs small and focused; use descriptive commit messages.
- A11y: label interactive elements (`aria-label`, `aria-pressed`); use `role=list`/`listitem` for lists.

## Releases
- Tag releases from `main` (e.g., `ui-v2-beta`).
- GitHub Release body can use the corresponding `RELEASE_NOTES_*` file.

## Branch protection
`main` has a ruleset:
- Require a pull request before merging
- Block force pushes
- Restrict deletions
(Required checks can be added later when CI exists.)

## Troubleshooting
- Two UIs running? Start one launcher normally (backend+UI) and in the other use `SKIP_BACKEND=1`.
- Previews not playing in dev? Ensure `VITE_API_BASE_URL=http://127.0.0.1:7860` so `/audio/...` hits the backend.
- XTTS port busy? Set `TAKE_OVER=1` on the launcher to restart the server.

Happy shipping!
