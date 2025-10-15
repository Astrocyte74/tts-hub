Handoff: Favorites Unification (UI + API)

Status (merged in PR #7)
- Favorites are the single source of truth for presets in UI and API.
- Backend
  - `/api/synthesise` accepts `favoriteId`/`favoriteSlug` (and legacy `profileId`/`profileSlug`).
  - `backend/favorites_store.py` supports `notes`; import/export round-trips notes.
- Frontend
  - Star/unstar maps to `/api/favorites` create/delete with engine + voice + params (language/speed/trim; style for OpenVoice; seed for ChatTTS).
  - Quick select (Voice caret): Favorites first; Edit ✎ / Delete 🗑 / Manage Favorites…
  - Favorites (Voices) section: collapsible; compact rows with param summary + notes preview; actions (Preview/Edit/Unstar).
  - Favorites Manager dialog: list/filter (engine) + search; Edit/Delete; Import/Export. Import/Export removed from Quick settings.

Tech notes
- Hook order stabilized: all useMemo/useState hooks are top-level; no inline useMemo in JSX branches.
- Popover click handling fixed: internal clicks don’t close the popover; outside clicks do.
- Styles: `.fav-list`, `.fav-row*` handle compact favorites; `.popover__item` + `.popover__button:hover` added.

Next up (recommended)
1) Tags for favorites + tag filter in Manager.
2) Param chips in Quick select entries (same summary as row list).
3) Keyboard a11y in Manager (↑/↓ focus, Enter to edit; aria roles on listitems).
4) Optional: quick unstar overlay on favorite rows.

QA checklist
- Star/unstar creates/deletes in `/favorites`; entries appear in Manager + Quick select.
- Edit Favorite dialog persists label/notes/params and updates row summary + tooltip.
- Collapse Favorites persists via `kokoro:favoritesCollapsed`.
- `/api/favorites/export`/`/import` (merge) preserve notes; `/api/synthesise` works with `favoriteSlug`.

Contact
- See `AGENTS.md` component map; API details in `API_ROUTES.md`.
