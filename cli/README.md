Kokoro Playground – Favorites CLI

Lightweight CLI to exercise the Favorites API and synthesise audio using saved presets from the terminal.

Requirements
- Python 3.9+
- Backend running locally (default `http://127.0.0.1:7860`) — launch via `Start Kokoro Playground (XTTS Server).command`

Environment
- `TTSHUB_API_BASE` (default: `http://127.0.0.1:7860/api`)
- `TTSHUB_API_KEY` (optional; if server sets `FAVORITES_API_KEY`)

Usage
```
# Menu mode (recommended)
# Sticky filters are shown in the header and can be changed via option 3.
python3 cli/tts_cli.py menu

# List favorites
python3 cli/tts_cli.py list [--engine kokoro] [--tag star] [--json]

python3 cli/tts_cli.py synth --slug favorite--af-heart --text "Hello from CLI"
# or by id
python3 cli/tts_cli.py synth --id fav_6644b291e1dd --text "Hello"
# optional: download result and play it (macOS: afplay)
python3 cli/tts_cli.py synth --slug favorite--af-heart --text "Hello" --download out.wav --play

python3 cli/tts_cli.py choose [--engine kokoro] [--tag star] [--text "..."] [--download out.wav] [--play]

python3 cli/tts_cli.py export > favorites.json
python3 cli/tts_cli.py import favorites.json --mode merge
```

Notes
- When using `--download`, the CLI resolves relative `/audio/...` links against `TTSHUB_API_BASE` and saves the WAV locally.
- `--play` attempts to play WAV/MP3 using `afplay` (macOS). If unavailable, it will print the saved path.
