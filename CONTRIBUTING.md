# Contributing / Dev Workflow (Codex + Humans)

This repo’s active development happens in this directory (`kokoro_twvv`). `main` is the default branch; direct pushes are standard. PRs are optional and can be used when you want review or a discussion thread.

## Where to work
- Use: `~/projects/tts-hub/kokoro_twvv` (this folder is the real Git repo with `origin` remote).
- Avoid opening Codex in the project root (`~/projects/tts-hub`), which is a wrapper worktree.

## Branch model
- `main`: releasable state. Push directly.
- Feature branches (optional): short‑lived branches created from `origin/main` when you want a PR/review trail.

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

# 3) Optional: Open a PR on GitHub (base=main, compare=feat/<short-name>) if you want review; otherwise push directly to main.

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

## Hotkeys + Top‑bar CTA
- Keyboard: 1=Script, 2=Voice, 3=Engine, 4=Clips; G=Create clip; V=Voices; R=Clips; S=Settings; Shift+/?=AI Assist.
- Scope: hotkeys are ignored while typing in inputs/textarea.
- The top‑bar “Create clip” button is the primary action; it is disabled until text, voice, and engine preconditions are met.

## Previews (Kokoro)
- Per‑card “Generate preview” chip on voices without samples.
- Bulk: “Generate previews for N” in the Voices header (operates on filtered set).
- Progress is shown in the bottom Results drawer (Queue tab) and as a live badge on the top bar Clips chip.

## Adding a new engine
- Engine cards live in `frontend/src/components/SynthesisControls.tsx`. Add a blurb by extending the `blurbs` map with a `tagline` and `strengths` list.
- Iconography: we currently use emoji placeholders; prefer replacing with a small inline SVG set for consistency (future pass welcome).
- A11y: keep the fallback `<select>` in place (off‑screen) for keyboard/screen‑reader users.

## QA checklist (UI v2 revamp)
- Queue → Clips auto-switches when the queue becomes empty and results exist.
- “Auto preview on hover” toggle disables both hover and focus previews when off; Preview button remains functional.
- “Auto open Clips on completion” works end-to-end and respects persistence.
- Quick voices caret appears when Favorites/Recent exist; selecting a voice swaps and returns to Script.
- History labels are replaced with “Clips” across the UI.

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
`main` allows direct pushes by maintainers. We still avoid force pushes and branch deletions.
(Required checks/PRs can be re‑enabled later when CI exists.)

## Troubleshooting
- Two UIs running? Start one launcher normally (backend+UI) and in the other use `SKIP_BACKEND=1`.
- Previews not playing in dev? Ensure `VITE_API_BASE_URL=http://127.0.0.1:7860` so `/audio/...` hits the backend.
- XTTS port busy? Set `TAKE_OVER=1` on the launcher to restart the server.

Happy shipping!
