🧩 Project Kokoro TWVV Feature Merge Plan

Objective:
Elevate kokoro_twvv to become the primary, production-ready Kokoro repo by integrating missing functionality from kokoro while preserving TWVV’s clean React + Flask architecture.

⸻

1️⃣ Core Feature Additions

Feature    Implementation Goals    Notes
Model Bootstrap    - Add auto-download of kokoro-v1.0.onnx and voices-v1.0.bin in Start Kokoro Playground (XTTS Server).command.- Create models/ directory automatically.- Support override via .env and skip download if present.    Mimic bootstrap logic from kokoro but use POSIX-safe syntax; include optional KOKORO_AUTO_DOWNLOAD=1 flag.
Meta Endpoint (/api/meta)    - Expose API prefix, port, model/voice presence, and available random-text categories.- Frontend should fetch /api/meta on mount to populate dropdowns and disable synthesis when models missing.    Return JSON like { api_prefix, port, has_model, has_voices, random_categories }.
Grouped-Voice UI    - Add /api/voices_grouped returning accent-aware voice data (id/label/flag).- Frontend: modify VoiceSelector.tsx to render filter chips with flags and counts.    Map voice prefixes/locales to accent metadata (e.g., 🇺🇸 American, 🇬🇧 British, 🇦🇺 Australian).
Documentation & Env Templates    - Write full README.md and PROJECT_OVERVIEW.md based on kokoro docs.- Ensure .env.example lists all variables with explanations.    Include dev vs prod instructions, ports, model paths, and launcher usage.


⸻

2️⃣ Optional Enhancements (Recommended)

Enhancement    Goal    Priority
Waveform Playback    Integrate wavesurfer.js or React-WaveSurfer for visual playback feedback.    Medium
Result History    Maintain a list of generated clips with playback and download links.    Medium
UI Persistence    Persist selected voices and categories in localStorage.    Low


⸻

3️⃣ Backend Adjustments
    •    Add /api/voices_grouped and /api/meta.
    •    Ensure /api/random_text gracefully falls back to local snippets when Ollama unavailable.
    •    Add /api/health for launcher diagnostics.
    •    Verify static serving of frontend/dist for production.

⸻

4️⃣ Launcher Enhancements
    •    Extend existing POSIX launcher to:
    •    Download missing models if KOKORO_AUTO_DOWNLOAD=1.
    •    Load .env for model paths and ports.
    •    Add prod mode: build SPA and serve via Flask only.
    •    Log steps clearly and use dependency stamp check.

⸻

5️⃣ Documentation Deliverables
    •    README.md
    •    Updated setup instructions (dev / prod).
    •    Explanation of .env variables.
    •    Example API routes.
    •    PROJECT_OVERVIEW.md
    •    Architecture overview (React + Flask).
    •    Description of endpoints and frontend components.
    •    .env.example
    •    Include model paths, API base URL, and auto-download toggle.

⸻

6️⃣ Verification Checklist

Area    Expected Result    Status
Model Bootstrap    Models auto-download if missing    ☐
Meta Endpoint    /api/meta returns runtime info    ☐
Grouped-Voice UI    UI shows grouped voices    ☐
Docs & Env Templates    Complete and accurate    ☐
Waveform Playback    Visual playback available    ☐ (optional)
Result History    Multi-clip playback list    ☐ (optional)
