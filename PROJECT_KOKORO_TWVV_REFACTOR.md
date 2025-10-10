🧩 Project Kokoro TWVV Refactor Plan

Objective:
We have created three Kokoro variants using different CODEX models.  Upgrade the kokoro_twvv (React + Flask) build into a “best-of-the-best” implementation that blends the maintainability and modern tooling of this branch with the functional depth of the original kokoro project.

Primary workspace: ~/projects/kokoro_twvv

⸻

1️⃣ Current Strengths
    •    Clean backend / frontend split with backend/ and frontend/ directories.
    •    Uses React + TypeScript + React Query — highly maintainable, typed, and test-friendly.
    •    Single-window startup experience with good environment variable injection (VITE_API_*).
    •    Robust API error handling and CORS configuration.

These qualities make twvv ideal as a developer-friendly foundation.

⸻

2️⃣ Weaknesses / Gaps to Fix

Area    Current Issue    Goal
Model Bootstrap    Assumes pre-existing local kokoro models; fails if missing    Add automatic model/voice download like original kokoro
Flask ↔ Frontend    Dev-only; lacks production fallback    Serve built frontend/dist when Vite is absent
Launcher    No dependency stamp; reinstall risk    Add .deps_installed check and skip redundant installs
Feature Parity    Missing random-text categories, grouped voices, announcer    Port full API surface from kokoro + add announcer
Docs / Env    Minimal docs and incomplete .env.example    Expand docs + add configurable paths
Multi-Platform    macOS-biased paths    Use cross-platform os.path and .env variables


⸻

3️⃣ Integration Targets

Source Project    What to Adopt    Why
kokoro (refactored original)    Auto model bootstrap + Flask fallback + rich API endpoints    Adds resilience + feature completeness
kokoro_twvv_5 (GPT-5 Vue)    Optional “announcer” control + small UI tweaks    Improves audition experience
Codex-High Recap    Config templating + .env parser + dependency stamps    Cross-platform setup improvements


⸻

4️⃣ Design Principles
    1.    One-Terminal Flow — no AppleScript; use concurrently if dual processes are needed.
    2.    Self-Healing Launcher — creates venv, installs deps only if missing, downloads models automatically.
    3.    Config-Driven Paths — rely on .env for KOKORO_MODEL, KOKORO_VOICES, VITE_API_BASE_URL.
    4.    Feature Parity + Type Safety — mirror kokoro features but keep React’s type-safe API layer.
    5.    Cross-Platform Ready — all shell commands POSIX-safe, no hard-coded /Users/… paths.

⸻

5️⃣ Step-by-Step Implementation (for Codex)
    1.    Create Branch → feature/refactor-reconsolidation
    2.    Refactor Launcher
    •    Add dependency stamp check (.deps_installed).
    •    Integrate model auto-download (ONNX + voices).
    •    Inject .env variables for API base and prefix.
    •    Remove any AppleScript or macOS-specific calls.
    3.    Enhance Backend
    •    Merge endpoints from kokoro: /api/meta, /api/ollama_models, grouped voices, random text categories.
    •    Implement announcer support in /api/audition.
    •    Ensure consistent JSON schema + error envelopes.
    •    Serve static frontend/dist if Vite is not running.
    4.    Improve Frontend
    •    Expand .env.example and propagate VITE_API_* vars.
    •    Add announcer toggle + random text controls.
    •    Confirm React Query / TanStack integration handles new endpoints.
    •    Verify build works with Flask static serving.
    5.    Documentation
    •    Update PROJECT_OVERVIEW.md + README.md to reflect new bootstrap behavior.
    •    Include setup table for macOS + Linux.
    6.    Testing
    •    Run launcher on clean machine: expect auto-download → browser open.
    •    Disable Node to verify Flask fallback.
    •    Validate all endpoints return 200 OK.

⸻

6️⃣ Optional Enhancements
    •    Add Dockerfile with dual-stage (backend + frontend) build.
    •    Introduce CLI helpers for TTS tests (mirror scripts/playground from kokoro).
    •    Integrate basic Jest / Vitest tests for frontend API client.
    •    Use python-dotenv for robust env parsing.

⸻

7️⃣ Verification Checklist

Area    Expected Result    Status
Launcher    Single-window, self-healing    ☐
Model Bootstrap    Auto-downloads models    ☐
Backend API    Matches kokoro feature set    ☐
Frontend    Announcer + random text UI    ☐
Cross-Platform    Works macOS + Linux    ☐
Docs    Updated / clear    ☐


