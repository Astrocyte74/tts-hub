# Kokoro UI — CodexB Branch (Phase 2)

This branch delivers the Phase 2 UI/UX enhancements on top of the modernized SPA. It is the reference for “Kokoro UI v2 Beta”.

What’s included
- Top Context Bar (Phase 1): engine, selection summary, clips, status; quick actions (Settings, Quick Generate, Results).
- Queue + Clips drawer: bottom dock with tabs, optimistic progress, cancel stub, and session persistence.
- Voice Browser 2.0: hover micro‑preview, favorites with a pinned row, facet chips (Language/Gender/Style) with counts.
- Script Authoring: SSML helper chips (Pause, Emphasis, Pitch, Rate), word/char/duration counters, basic SSML validation.
- Results: Waveform player + new mini waveform with loop/trim and “Export selection” (WAV).
- Media Editor: Transcript panel with a functional waveform canvas (minimap, zoom presets, styles/overlays, hover tooltips, selection sync, save‑as‑default view).
- Accessibility: ARIA roles for lists, buttons, and controls; consistent focus outlines.

Usage
1) Launch the worktree: `./Start Kokoro Playground (XTTS Server).command`
   - Uses shared models from `../kokoro_twvv/models` when available
   - If another backend is running, launcher reuses it and runs UI‑only
2) Generate audio; open the Results drawer to see Queue/Clips.
3) Voice Browser: hover a card to preview (if sample provided), star favorites, filter via facet chips.
4) Waveform Trim: adjust Start/End, toggle Loop, click Export selection to download a WAV slice.

Queue & Clips
- Queue items progress from pending → rendering → done (or error/canceled).
- Progress is optimistic (UI ticks to ~90% while waiting, then 100%).
- Clear queue/clips buttons; both persist using sessionStorage.

Accessibility
- Voice lists and queue use role=list/listitem.
- Interactive controls have aria-label/aria-pressed where applicable.
- Focus outlines use :focus-visible and pass WCAG AA contrast.

Phase 3 (planned)
- Permanent preview generation (opt‑in): `POST /api/voices/preview` to cache short MP3s under `out/voice_previews/`, with TTL cleanup. UI adds a “Generate preview” chip on cards without samples and a bulk action for filtered sets. Results integrate with the Queue drawer.
