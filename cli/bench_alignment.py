#!/usr/bin/env python3
"""
Benchmark Faster-Whisper transcription vs WhisperX alignment on a single audio file.

Usage:
  python cli/bench_alignment.py --file <audio_path>
  python cli/bench_alignment.py  # auto-picks the shortest file in out/media_cache/youtube

It prints:
  - Audio duration
  - Transcribe time and RTF (duration / elapsed)
  - Align time and RTF (duration / elapsed)
  - Optional boundary-delta summary (if word timestamps available)

Notes:
  - Run inside the backend virtualenv so dependencies are present:
      ./.venv/bin/python cli/bench_alignment.py --file out/media_cache/youtube/<file>
  - For macOS GPU, WhisperX uses MPS when available. Otherwise CPU.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


def find_shortest_in_cache(root: Path) -> Optional[Path]:
    if not root.exists():
        return None
    candidates: List[Path] = []
    for p in root.glob("*.*"):
        if p.suffix.lower() in {".wav", ".mp3", ".m4a", ".webm", ".opus", ".ogg", ".flac"}:
            candidates.append(p)
    if not candidates:
        return None
    return min(candidates, key=lambda p: p.stat().st_size)


def ffprobe_duration_seconds(path: Path) -> float:
    import subprocess
    try:
        proc = subprocess.run([
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path),
        ], capture_output=True, text=True, check=True)
        return float((proc.stdout or "0").strip() or 0)
    except Exception:
        return 0.0


@dataclass
class BenchResult:
    audio_path: Path
    duration: float
    transcribe_elapsed: float
    transcribe_rtf: float
    align_elapsed: float
    align_rtf: float
    diff: Optional[Dict[str, Any]]


def compute_diff(prev_words: List[Dict[str, Any]], new_words: List[Dict[str, Any]]) -> Dict[str, Any]:
    n = min(len(prev_words), len(new_words))
    if n == 0:
        return {"compared": 0}
    abs_ms: List[float] = []
    changed = 0
    tops: List[Tuple[int, str, float]] = []  # (idx, text, delta_ms signed)
    for i in range(n):
        p = prev_words[i]
        q = new_words[i]
        try:
            ps = float(p.get("start", 0) or 0); pe = float(p.get("end", 0) or 0)
            qs = float(q.get("start", 0) or 0); qe = float(q.get("end", 0) or 0)
        except Exception:
            continue
        pt = str(p.get("text") or p.get("word") or "").strip()
        qt = str(q.get("text") or q.get("word") or "").strip()
        if not pt or pt != qt:
            continue
        ds = abs(qs - ps); de = abs(qe - pe)
        chosen = (qs - ps) if ds >= de else (qe - pe)
        if abs(chosen) > 1e-6:
            changed += 1
        abs_ms.append(abs(chosen) * 1000.0)
        tops.append((i, qt, chosen * 1000.0))
    abs_ms_sorted = sorted(abs_ms)
    def _pct(p: float) -> float:
        if not abs_ms_sorted:
            return 0.0
        k = max(0, min(len(abs_ms_sorted)-1, int(round(p * (len(abs_ms_sorted)-1)))))
        return float(abs_ms_sorted[k])
    mean = sum(abs_ms) / len(abs_ms) if abs_ms else 0.0
    med = _pct(0.5)
    p95 = _pct(0.95)
    mx = abs_ms_sorted[-1] if abs_ms_sorted else 0.0
    top_sorted = sorted(tops, key=lambda t: abs(t[2]), reverse=True)[:10]
    top_out = [
        {"idx": idx, "text": txt, "delta_ms": delta, "direction": ("later" if delta >= 0 else "earlier")}
        for idx, txt, delta in top_sorted
    ]
    return {
        "compared": n,
        "changed": changed,
        "mean_abs_ms": mean,
        "median_abs_ms": med,
        "p95_abs_ms": p95,
        "max_abs_ms": mx,
        "top": top_out,
    }


def bench(audio_path: Path, model_size: str = "base", device: Optional[str] = None) -> BenchResult:
    from faster_whisper import WhisperModel  # type: ignore
    import whisperx  # type: ignore
    import torch  # type: ignore

    duration = ffprobe_duration_seconds(audio_path)
    # Resolve device for alignment (whisperx)
    resolved_device = device
    if not resolved_device or resolved_device == "auto":
        try:
            if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():  # type: ignore[attr-defined]
                resolved_device = 'mps'
            elif torch.cuda.is_available():
                resolved_device = 'cuda'
            else:
                resolved_device = 'cpu'
        except Exception:
            resolved_device = 'cpu'

    # 1) Faster-Whisper transcription (word timestamps)
    t0 = time.time()
    model = WhisperModel(model_size, device=device or "auto")
    t1 = time.time()
    segments_iter, info = model.transcribe(str(audio_path), word_timestamps=True)
    segments = list(segments_iter)
    words_fw: List[Dict[str, Any]] = []
    for seg in segments:
        for w in (seg.words or []):
            words_fw.append({"text": w.word, "start": w.start, "end": w.end})
    transcribe_elapsed = time.time() - t0
    transcribe_rtf = duration / max(transcribe_elapsed, 1e-6) if duration > 0 else 0.0

    # Build WhisperX input from FW segments
    fw_segments = [{"text": s.text, "start": s.start, "end": s.end} for s in segments]
    if not fw_segments:
        # fallback: derive from words
        if words_fw:
            fw_segments = [{"text": " ".join(w["text"] for w in words_fw), "start": words_fw[0]["start"], "end": words_fw[-1]["end"]}]
        else:
            fw_segments = []

    # 2) WhisperX alignment
    language_code = getattr(info, 'language', 'en')
    align_model, metadata = whisperx.load_align_model(language_code=language_code, device=resolved_device)
    ta = time.time()
    aligned = whisperx.align(fw_segments, align_model, metadata, str(audio_path), device=resolved_device, return_char_alignments=False)
    align_elapsed = time.time() - ta
    align_rtf = duration / max(align_elapsed, 1e-6) if duration > 0 else 0.0
    words_wx: List[Dict[str, Any]] = []
    for seg in (aligned.get("segments") or []):
        for w in seg.get("words") or []:
            words_wx.append({"text": str(w.get("word") or w.get("text") or "").strip(), "start": float(w.get("start") or 0), "end": float(w.get("end") or 0)})

    diff = compute_diff(words_fw, words_wx) if words_fw and words_wx else None
    return BenchResult(audio_path=audio_path, duration=duration, transcribe_elapsed=transcribe_elapsed, transcribe_rtf=transcribe_rtf, align_elapsed=align_elapsed, align_rtf=align_rtf, diff=diff)


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark Faster-Whisper vs WhisperX alignment")
    parser.add_argument("--file", type=str, default=None, help="Path to audio file (if omitted, uses shortest in out/media_cache/youtube)")
    parser.add_argument("--model", type=str, default=os.environ.get("WHISPER_MODEL", "base"), help="Faster-Whisper model size (default: base or $WHISPER_MODEL)")
    parser.add_argument("--device", type=str, default=None, help="Device override (auto|cpu|cuda|mps)")
    args = parser.parse_args()

    root = Path.cwd()
    audio = Path(args.file) if args.file else find_shortest_in_cache(root / "out" / "media_cache" / "youtube")
    if not audio or not audio.exists():
        print("Audio file not found. Provide --file or ensure out/media_cache/youtube has audio.")
        return 2
    res = bench(audio, model_size=args.model, device=args.device)
    print("=== Benchmark ===")
    print(f"File: {res.audio_path}")
    print(f"Duration: {res.duration:.2f}s")
    print(f"Transcribe: {res.transcribe_elapsed:.2f}s (RTF {res.transcribe_rtf:.2f}×)")
    print(f"Align:      {res.align_elapsed:.2f}s (RTF {res.align_rtf:.2f}×)")
    if res.diff and res.diff.get("compared", 0) > 0:
        print("Diff:")
        print(f"  Compared {res.diff['compared']} words; changed {res.diff.get('changed', 0)}")
        print(f"  Mean |Δ| {res.diff.get('mean_abs_ms', 0):.0f} ms; Median {res.diff.get('median_abs_ms', 0):.0f} ms; P95 {res.diff.get('p95_abs_ms', 0):.0f} ms; Max {res.diff.get('max_abs_ms', 0):.0f} ms")
        tops = res.diff.get('top') or []
        if tops:
            top_str = ", ".join([f"{t.get('text','')} {abs(float(t.get('delta_ms') or 0)):.0f} ms {'later' if float(t.get('delta_ms') or 0)>=0 else 'earlier'}" for t in tops[:5]])
            print(f"  Examples: {top_str}{' …' if len(tops) > 5 else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
