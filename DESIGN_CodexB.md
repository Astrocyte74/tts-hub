# CodexB UI/UX Wireframe – Scope

This branch focuses on two high‑impact layout improvements to make comparisons easy:

- Top Context Bar: persistent header with engine, selection summary, status, and quick actions (Settings, Quick Generate, Results).
- Bottom Results Drawer: collapsible dock for Queue/Results (wireframe shows Results for now).

Notes
- Intent is non‑destructive: existing panels remain; drawer mirrors the Results panel for evaluation.
- Scrolling to Settings is supported via a simple anchor so the header’s button has a visible effect immediately.
- Further items from the redesign plan will be layered onto this branch if we proceed with it.

Run locally
1. Checkout: `git checkout ui-redesign-codexB` in `kokoro_twvv/`.
2. Dev: `cd frontend && npm run dev` (or use the launcher script in repo root).
3. Toggle the drawer from the top bar; try Quick Generate with a selected voice.
