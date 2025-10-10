# Using Kokoro Models From This Repo

The Kokoro ONNX model and voice bank downloaded for this project live at:

- Model: `/Users/markdarby/projects/kokoro_twvv/models/kokoro-v1.0.onnx`
- Voices: `/Users/markdarby/projects/kokoro_twvv/models/voices-v1.0.bin`

You can point other local projects at these files instead of duplicating downloads. If you still maintain the legacy `~/projects/kokoro` repo, its `models/` directory remains compatible—just update the environment variables accordingly.

## 1. Ensure Python Environment

The existing `.venv` in this repo already has Kokoro and its dependencies (Flask, `onnxruntime`, `requests`, etc.). You can either reuse it or install Kokoro in another environment.

To reuse the existing virtualenv:

```bash
source /Users/markdarby/projects/kokoro_twvv/.venv/bin/activate
```

If you prefer a dedicated environment elsewhere, install via:

```bash
python3 -m venv /path/to/venv
source /path/to/venv/bin/activate
pip install --no-deps kokoro-onnx==0.4.7
pip install numpy==2.0.2 librosa==0.11.0 numba==0.60.0 onnxruntime==1.19.2 soundfile phonemizer-fork==3.3.1 espeakng_loader==0.2.4 huggingface_hub requests
```

## 2. Set Environment Variables

Most scripts (including this repo’s CLI helpers) look for `KOKORO_MODEL` and `KOKORO_VOICES`. Configure them in the shell before running your external project:

```bash
export KOKORO_MODEL="/Users/markdarby/projects/kokoro_twvv/models/kokoro-v1.0.onnx"
export KOKORO_VOICES="/Users/markdarby/projects/kokoro_twvv/models/voices-v1.0.bin"
```

You can add these to your shell profile (`~/.zshrc`, etc.) if you intend to reuse them frequently.

## 3. Use Kokoro in Another Project

In Python:

```python
from kokoro_onnx import Kokoro

tts = Kokoro(
    "/Users/markdarby/projects/kokoro_twvv/models/kokoro-v1.0.onnx",
    "/Users/markdarby/projects/kokoro_twvv/models/voices-v1.0.bin",
)
audio, sr = tts.create("Hello from another project!", voice="af_heart", speed=1.0, lang="en-us")
```

Or rely on the environment variables:

```python
import os
from kokoro_onnx import Kokoro

tts = Kokoro(os.environ["KOKORO_MODEL"], os.environ["KOKORO_VOICES"])
```

To list available voices:

```python
import numpy as np

with np.load("/Users/markdarby/projects/kokoro_twvv/models/voices-v1.0.bin") as z:
    print(sorted(z.files))
```

## 4. Optional: Symlink or Copy

If another project expects the model files under its own `models/` directory, you can create symbolic links:

```bash
ln -s /Users/markdarby/projects/kokoro_twvv/models/kokoro-v1.0.onnx /path/to/other-project/models/kokoro-v1.0.onnx
ln -s /Users/markdarby/projects/kokoro_twvv/models/voices-v1.0.bin /path/to/other-project/models/voices-v1.0.bin
```

Symlinking avoids duplicate ~337MB downloads while keeping per-project folder structures intact.

## 5. Notes

- Ensure filesystem permissions allow the other project to read the shared model files.
- Kokoro performs all inference locally via ONNX Runtime; no additional services are required.
- The voice bank is immutable. Updates or additional voices would require downloading new `.bin` files and updating the paths above.

With the environment variables set (or direct paths supplied), any project using `kokoro-onnx` can leverage the models that are already installed here.
