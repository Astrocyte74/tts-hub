# Kokoro Playground SPA — Enhanced UI/UX Wireframe Overview

This document translates the proposed UX improvements into a high-level wireframe specification for the SPA. It captures primary layout zones, key interactions, and state considerations so design prototypes (Figma or similar) can move forward quickly.

## 1. Top Context Bar (Persistent Header)
- **Purpose:** Provide situational awareness and one-click access to global actions.
- **Layout:**
  - **Left:** Kokoro mark + “Kokoro Playground” label (click → About modal).
  - **Center:** Segmented chips summarising session context: `Engine: Kokoro ONNX`, `Voice: Hf Alpha`, `Clips: 3`.
  - **Right controls:** `⚙️ Settings`, `🧠 Model Status` (Ready/Loading/Error), `▶️ Quick Generate`.
- **Interactions:**
  - Clicking the voice chip opens a condensed voice palette overlay anchored to the header.
  - Model status doubles as a tooltip surface for latency, backend health, GPU/CPU utilisation.
  - Header condenses into a single menu when viewport < 1024px (chips collapse under a kebab button).

## 2. Script Authoring Panel
- **Purpose:** Primary creative workspace for crafting TTS copy.
- **Structure:**
  - Toolbar strip above textarea containing:
    - Live word/character count + estimated speech duration (based on 150 wpm default).
    - SSML helpers: `Pause`, `Emphasis`, `Pitch`, `Rate` insert tagged snippets at cursor.
    - Snippet dropdown (Promo, Narration, Explainer, IVR, Audiobook) with preview text.
    - `AI Assist` toggle opens right-side drawer offering Shorter / Energetic / Proofread rewrites (requires Ollama).
  - Text area with light SSML syntax highlighting, line numbers optional.
- **States:**
  - Validation feedback surfaces inline (red underline on malformed tags, summary banner under toolbar).
  - When AI Assist is unavailable, the toggle presents a tooltip linking to configuration instructions.

## 3. Voice Discovery & Management
- **Purpose:** Accelerate selecting, comparing, and managing voices.
- **Layout:**
  - Top row pinned “Favorites” carousel (max 6 visible, scrollable).
  - Filter chip row (Language, Gender, Tone, Accent) with selected count badges and include/exclude toggle per chip.
  - Main grid uses interactive cards (2–3 columns depending on width).
- **Card interactions:**
  - Hover (or tap-hold on touch) reveals a micro-preview play button.
  - Star icon toggles favorite state; shift-click adds voice to multi-select audition queue.
  - Clicking body opens a side drawer with waveform sample, descriptive tags, recommended pitch/rate ranges, personal notes field.
- **Empty/filter states:** Provide friendly prompts and quick-reset button.

## 4. Settings (Contextual Popover)
- **Purpose:** Keep the canvas clean while preserving quick access to controls.
- **Details:**
  - `⚙️ Settings` in header opens a popover containing secondary toggles: Trim silence, Autoplay new clips, Announcer options, gap duration, advanced playback defaults.
  - Primary dropdowns (Engine, Language) remain visible below the script panel for discoverability.
  - Speed slider lives near language selector with small live-preview badge (plays 1s sample).

## 5. Queue & Results Drawer
- **Purpose:** Track generation progress and retain history.
- **Layout:**
  - Bottom dock, collapsible. Default height ~260px; expands to 60% height when needed.
  - Tabbed interface: `Queue` (pending/in-flight) and `History` (completed).
  - Each item row features waveform thumbnail, voice name, duration, status badge, and action cluster (play, download, rename, delete).
- **Behaviours:**
  - Queue items animate from pending → rendering → ready with progress bars.
  - History supports multi-select for bulk download (ZIP), delete, or rerun.
  - Drawer remembers open/closed state per session.

## 6. Comparisons & Playback Enhancements
- **AB/ABX testing:**
  - Dedicated comparison mode accessible from History or directly after generating multiple clips.
  - UI shows two (AB) or three (ABX) tiles with hotkey hints (`1`, `2`, `X`, `Space` to reveal).
  - Include “Reveal answer” banner for blind tests.
- **Waveform player upgrades:**
  - Add draggable trim handles above waveform.
  - Loop toggle and range selector.
  - Export modal offering full clip or trimmed selection (WAV/MP3).

## 7. Accessibility & Keyboard Support
- **Keyboard map:**
  - `/` focuses global search.
  - `Cmd/Ctrl + Enter` triggers Quick Generate.
  - `J`/`K` navigate voice list, `F` toggles favorite, `Space` plays preview.
- **Accessibility targets:**
  - All interactive elements labelled with ARIA attributes.
  - Focus outlines visible in both default and high-contrast themes.
  - Provide text-size slider (90–125%) and high-contrast toggle inside Settings popover.

## 8. Visual & Motion Guidelines
- **Styling cues:**
  - Maintain current dark theme palette; introduce depth via layered glassmorphism cards.
  - Chips share consistent radius and subtle glowing border when active.
- **Motion:**
  - 150ms ease-out hover lifts for cards, 200ms fade for drawer transitions.
  - Progress shimmer for queue items to signal activity.
- **Empty states:**
  - Script panel: grey placeholder with sample prompts and “Generate Sample Script” CTA.
  - Queue/history: illustration + quick link to documentation/tutorial.

## 9. Future Extensions (Backlog)
- Projects view for saved setups (script + voice + settings).
- Offline cache indicator (voices metadata + local clips availability).
- Header badge showing backend latency and resource utilisation (GPU/CPU).

## Acceptance Checklist
- Header remains usable down to 1024px width (collapses gracefully).
- Script validation handles malformed SSML without blocking editing.
- Voice hover preview works with keyboard focus (press `Space` to play when focused).
- Queue drawer accurately reflects backend status (leverages API streaming or polling).
- All new interactions documented with keyboard shortcuts and tooltips.

## Open Questions
1. Should Quick Generate render using last selected voice or prompt for voice each time?
2. Do we synthesise micro-previews on the fly or ship short cached snippets with the app?
3. How do we store user notes per voice (localStorage vs. backend)?
4. Is AI Assist gated behind a feature flag when Ollama is unavailable?

Use this brief to produce mid-fidelity wireframes or prototypes. Once layouts are approved, we can translate sections into component tickets for implementation.
