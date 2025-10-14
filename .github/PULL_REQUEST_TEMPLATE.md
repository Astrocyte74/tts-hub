## Summary

Describe the change in one or two sentences.

## Type of change
- [ ] Feature
- [ ] Fix
- [ ] Docs / DX
- [ ] Refactor / chore

## Screenshots / Demos (if UI)

Add before/after or a short clip if relevant.

## How to test
1. Branch: `feat/<short-name>` from `origin/main`
2. Worktree: `/Users/markdarby/projects/tts-hub/kokoroB`
3. Run one of:
   - Full stack: `./Start\ Kokoro\ Playground\ \(XTTS\ Server\).command`
   - UI‑only: `SKIP_BACKEND=1 ./Start\ Kokoro\ Playground\ \(XTTS\ Server\).command`
   - If UI‑only, set `VITE_API_BASE_URL=http://127.0.0.1:7860`
4. Verify acceptance for the feature below.

## Acceptance checklist
- [ ] I read `CONTRIBUTING.md` and worked in `kokoroB` (not the main worktree).
- [ ] No generated audio or previews (`out/`) are committed.
- [ ] Launchers/ports are respected; no hardcoded ports added.
- [ ] UI changes tested with the launcher and look good in the Results drawer and top bar.
- [ ] Previews (per‑card/bulk) behave correctly if affected.
- [ ] Accessibility: added `aria-label`/`aria-pressed` where needed; lists use `role=list`/`listitem`.
- [ ] Docs updated if necessary (`AGENTS.md`, `API_ROUTES.md`, `DESIGN.md`, `CHANGELOG.md`).

## Linked issues
Closes #<id> / Related to #<id>

