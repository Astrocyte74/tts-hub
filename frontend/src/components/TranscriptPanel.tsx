import { useEffect, useRef, useState } from 'react';
import { mediaAlignFull, mediaAlignRegion, mediaApply, mediaGetStats, mediaReplacePreview, mediaTranscribeFromUrl, mediaTranscribeUpload } from '../api/client';
import type { MediaTranscriptResult } from '../types';

export function TranscriptPanel() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [whisperxEnabled, setWhisperxEnabled] = useState<boolean>(false);
  const [regionStart, setRegionStart] = useState<string>('');
  const [regionEnd, setRegionEnd] = useState<string>('');
  const [regionMargin, setRegionMargin] = useState<string>('0.75');
  const [replaceText, setReplaceText] = useState<string>('');
  const [replacePreviewUrl, setReplacePreviewUrl] = useState<string | null>(null);
  const [finalUrl, setFinalUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<MediaTranscriptResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [avgRtf, setAvgRtf] = useState<{ full: number; region: number; transcribe: number }>({ full: 5, region: 5, transcribe: 10 });
  const progressTimer = useRef<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  // Word selection state (drag to select)
  const [isSelecting, setIsSelecting] = useState(false);
  const [selStartIdx, setSelStartIdx] = useState<number | null>(null);
  const [selEndIdx, setSelEndIdx] = useState<number | null>(null);
  const [isPreviewingSel, setIsPreviewingSel] = useState(false);

  function clearSelection() {
    setSelStartIdx(null);
    setSelEndIdx(null);
  }

  function updateRegionFromIdxRange(aIdx: number, bIdx: number) {
    if (!transcript?.words?.length) return;
    const lo = Math.max(0, Math.min(aIdx, bIdx));
    const hi = Math.min(transcript.words.length - 1, Math.max(aIdx, bIdx));
    const ws = transcript.words.slice(lo, hi + 1);
    if (ws.length) {
      setRegionStart(ws[0].start.toFixed(2));
      setRegionEnd(ws[ws.length - 1].end.toFixed(2));
    }
  }

  async function previewSelectionOnce() {
    const start = Number(regionStart);
    const end = Number(regionEnd);
    if (!audioRef.current || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    const audio = audioRef.current;
    const stopAt = end - 0.02;
    const playFrom = () => {
      try {
        audio.currentTime = start;
      } catch { /* ignore seek issues */ }
      const onTime = () => {
        if (audio.currentTime >= stopAt) {
          audio.pause();
          audio.removeEventListener('timeupdate', onTime);
          setIsPreviewingSel(false);
        }
      };
      audio.addEventListener('timeupdate', onTime);
      setIsPreviewingSel(true);
      void audio.play().catch(() => setIsPreviewingSel(false));
    };
    if (Number.isNaN(audio.duration) || audio.readyState < 1) {
      const onMeta = () => {
        audio.removeEventListener('loadedmetadata', onMeta);
        playFrom();
      };
      audio.addEventListener('loadedmetadata', onMeta);
      // force load by (re)assigning src if needed
      // no-op here because the tag already has src
    } else {
      playFrom();
    }
  }

  // Fetch stats for ETA when panel first opens
  async function refreshStats() {
    try {
      const s = await mediaGetStats();
      setAvgRtf({
        transcribe: typeof s.transcribe?.avg_rtf === 'number' && s.transcribe.avg_rtf > 0 ? s.transcribe.avg_rtf : 10,
        full: typeof s.align_full?.avg_rtf === 'number' && s.align_full.avg_rtf > 0 ? s.align_full.avg_rtf : 5,
        region: typeof s.align_region?.avg_rtf === 'number' && s.align_region.avg_rtf > 0 ? s.align_region.avg_rtf : 5,
      });
    } catch {
      // ignore
    }
  }

  // Fetch stats once when panel opens
  useEffect(() => {
    if (open) {
      void refreshStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleTranscribe(kind: 'url' | 'file') {
    try {
      setBusy(true);
      setStatus(kind === 'url' ? 'Transcribing URL with faster‑whisper…' : 'Transcribing file with faster‑whisper…');
      setError(null);
      setTranscript(null);
      setAudioUrl(null);
      if (kind === 'url') {
        if (!url.trim()) {
          setError('Paste a YouTube URL first');
          return;
        }
        const res = await mediaTranscribeFromUrl(url.trim());
        setTranscript(res.transcript);
        setAudioUrl(res.media?.audio_url ?? null);
        setJobId(res.jobId);
        setWhisperxEnabled(Boolean(res.whisperx?.enabled));
        const elapsed = res.transcript?.stats?.elapsed ?? res.stats?.elapsed;
        const rtf = res.transcript?.stats?.rtf ?? res.stats?.rtf;
        if (typeof elapsed === 'number' && typeof rtf === 'number') {
          setStatus(`Transcribed in ${elapsed.toFixed(2)}s (RTF ${rtf.toFixed(2)}×)`);
        }
      } else {
        if (!file) {
          setError('Choose a media file to upload');
          return;
        }
        const res = await mediaTranscribeUpload(file);
        setTranscript(res.transcript);
        setAudioUrl(res.media?.audio_url ?? null);
        setJobId(res.jobId);
        setWhisperxEnabled(Boolean(res.whisperx?.enabled));
        const elapsed = res.transcript?.stats?.elapsed ?? res.stats?.elapsed;
        const rtf = res.transcript?.stats?.rtf ?? res.stats?.rtf;
        if (typeof elapsed === 'number' && typeof rtf === 'number') {
          setStatus(`Transcribed in ${elapsed.toFixed(2)}s (RTF ${rtf.toFixed(2)}×)`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transcription failed');
    } finally {
      setBusy(false);
      setStatus('');
    }
  }

  async function handleAlignFull() {
    if (!jobId) {
      setError('Transcribe first to create a job');
      return;
    }
    try {
      setBusy(true);
      setStatus('Aligning full transcript with WhisperX…');
      setError(null);
      // ETA progress: estimate using avgRtf.full and transcript duration
      if (transcript?.duration && avgRtf.full > 0) {
        const total = transcript.duration / avgRtf.full;
        const start = Date.now();
        setProgress(0);
        progressTimer.current = window.setInterval(() => {
          const elapsed = (Date.now() - start) / 1000;
          setProgress(Math.max(0, Math.min(1, elapsed / total)));
        }, 1000);
      }
      const res = await mediaAlignFull(jobId);
      setTranscript(res.transcript);
      const elapsed = res.stats?.elapsed;
      if (typeof elapsed === 'number') {
        const words = res.stats?.words ?? res.transcript?.words?.length ?? 0;
        setStatus(`Aligned full transcript in ${elapsed.toFixed(2)}s (words ${words})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Alignment failed');
    } finally {
      setBusy(false);
      setStatus('');
      if (progressTimer.current) { window.clearInterval(progressTimer.current); progressTimer.current = null; }
      setProgress(null);
      void refreshStats();
    }
  }

  return (
    <div className="panel panel--compact" style={{ marginTop: 12 }}>
      <div className="panel__header panel__header--dense" style={{ cursor: 'pointer' }} onClick={() => setOpen((v) => !v)}>
        <h3 className="panel__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}>▶</span>
          Transcript (beta)
        </h3>
        <p className="panel__meta">Transcribe and preview word timings</p>
      </div>
      {open ? (
        <div className="dialog-stack" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="panel__actions panel__actions--wrap" style={{ gap: 8 }}>
            <label className="field" style={{ minWidth: 280 }}>
              <span className="field__label">YouTube URL</span>
              <input type="url" placeholder="https://www.youtube.com/watch?v=..." value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
            <button className="panel__button" type="button" disabled={busy} onClick={() => handleTranscribe('url')}>Transcribe URL</button>
            <span className="panel__meta">or</span>
            <label className="field">
              <span className="field__label">Upload file</span>
              <input ref={fileInputRef} type="file" accept="audio/*,video/*,.mp4,.mkv,.mov,.mp3,.wav,.flac,.ogg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <button className="panel__button" type="button" disabled={busy} onClick={() => handleTranscribe('file')}>Transcribe File</button>
          </div>
          {error ? <p className="panel__hint panel__hint--warning">{error}</p> : null}
          {status ? (
            <p className="panel__hint panel__hint--notice" aria-live="polite">
              {busy ? '⏳ ' : ''}{status}
            </p>
          ) : null}
          {progress !== null ? (
            <div style={{ height: 6, background: 'rgba(148,163,184,0.2)', borderRadius: 6, overflow: 'hidden' }} aria-label="Estimated progress">
              <div style={{ width: `${Math.round(progress * 100)}%`, height: '100%', background: 'linear-gradient(90deg, #60a5fa, #22d3ee)' }} />
            </div>
          ) : null}
          {whisperxEnabled ? (
            <div className="panel__actions panel__actions--wrap" style={{ gap: 8 }}>
              <button className="panel__button" type="button" disabled={busy || !jobId} onClick={handleAlignFull}>
                {busy ? 'Aligning…' : 'Refine timings (WhisperX)'}
              </button>
              {!jobId ? <p className="panel__hint panel__hint--muted">Transcribe first to create a job.</p> : null}
              <div className="panel__meta" style={{ marginLeft: 12 }}>or refine a region:</div>
              <label className="field" aria-label="Region start" style={{ width: 120 }}>
                <span className="field__label">Start (s)</span>
                <input type="number" step="0.01" value={regionStart} onChange={(e) => setRegionStart(e.target.value)} />
              </label>
              <label className="field" aria-label="Region end" style={{ width: 120 }}>
                <span className="field__label">End (s)</span>
                <input type="number" step="0.01" value={regionEnd} onChange={(e) => setRegionEnd(e.target.value)} />
              </label>
              <label className="field" aria-label="Margin" style={{ width: 120 }}>
                <span className="field__label">Margin (s)</span>
                <input type="number" step="0.01" value={regionMargin} onChange={(e) => setRegionMargin(e.target.value)} />
              </label>
              <button
                className="panel__button"
                type="button"
                disabled={busy || !jobId}
                onClick={async () => {
                  if (!jobId) { setError('Transcribe first'); return; }
                  const s = Number(regionStart), e = Number(regionEnd), m = Number(regionMargin || '0.75');
                  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) { setError('Enter start/end seconds (end > start)'); return; }
                  try {
                    setBusy(true);
                    setStatus(`Aligning region ${s.toFixed(2)}–${e.toFixed(2)}s with WhisperX…`);
                    setError(null);
                    // ETA progress for region: include margin
                    const dur = (e - s) + (Number.isFinite(m) ? Number(m) * 2 : 1.5);
                    const total = dur / (avgRtf.region > 0 ? avgRtf.region : 5);
                    const startAt = Date.now();
                    setProgress(0);
                    progressTimer.current = window.setInterval(() => {
                      const elapsed = (Date.now() - startAt) / 1000;
                      setProgress(Math.max(0, Math.min(1, elapsed / total)));
                    }, 1000);
                    const res = await mediaAlignRegion(jobId, s, e, Number.isFinite(m) ? m : undefined);
                    setTranscript(res.transcript);
                    const elapsed = res.stats?.elapsed;
                    const rtf = res.stats?.rtf;
                    const words = res.stats?.words ?? 0;
                    if (typeof elapsed === 'number' && typeof rtf === 'number') {
                      setStatus(`Aligned ${words} words in ${elapsed.toFixed(2)}s (RTF ${rtf.toFixed(2)}×)`);
                    }
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Region alignment failed');
                  } finally {
                    setBusy(false);
                    setStatus('');
                    if (progressTimer.current) { window.clearInterval(progressTimer.current); progressTimer.current = null; }
                    setProgress(null);
                    void refreshStats();
                  }
                }}
              >
                {busy ? 'Aligning…' : 'Refine region'}
              </button>
            </div>
          ) : null}
          {/* Replace preview (XTTS) */}
          <div className="panel__actions panel__actions--wrap" style={{ gap: 8 }}>
            <label className="field" aria-label="Replace text" style={{ minWidth: 320 }}>
              <span className="field__label">Replace text</span>
              <input type="text" value={replaceText} onChange={(e) => setReplaceText(e.target.value)} placeholder="New line to speak…" />
            </label>
            <button
              className="panel__button panel__button--primary"
              type="button"
              disabled={busy || !jobId || !replaceText.trim()}
              onClick={async () => {
                if (!jobId) { setError('Transcribe first'); return; }
                const s = Number(regionStart), e = Number(regionEnd);
                if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) { setError('Enter start/end seconds (end > start)'); return; }
                try {
                  setBusy(true);
                  setStatus('Generating replace preview…');
                  setError(null);
                  setReplacePreviewUrl(null);
                  const res = await mediaReplacePreview({ jobId, start: s, end: e, text: replaceText, marginMs: Number(regionMargin) * 1000 });
                  setReplacePreviewUrl(res.preview_url);
                  const se = res.stats?.synth_elapsed;
                  if (typeof se === 'number') {
                    setStatus(`Synthesized and patched preview in ${se.toFixed(2)}s`);
                  }
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Replace preview failed');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Working…' : 'Preview replace'}
            </button>
          </div>
          {replacePreviewUrl ? (
            <div>
              <p className="panel__meta">Preview with replacement applied</p>
              <audio controls src={replacePreviewUrl} style={{ width: '100%' }} />
              <div className="panel__actions" style={{ gap: 8, marginTop: 8 }}>
                <button
                  className="panel__button panel__button--primary"
                  type="button"
                  disabled={busy || !jobId}
                  onClick={async () => {
                    if (!jobId) { setError('Transcribe first'); return; }
                    try {
                      setBusy(true);
                      setStatus('Applying preview to final output…');
                      const res = await mediaApply(jobId);
                      setFinalUrl(res.final_url);
                      setStatus(`Applied to ${res.mode === 'video' ? 'video' : 'audio'} (${res.container})`);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Apply failed');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? 'Working…' : 'Apply to video'}
                </button>
              </div>
              {finalUrl ? (
                <div style={{ marginTop: 8 }}>
                  <p className="panel__meta">Final output</p>
                  {/* If video, let browser attempt playback; if not supported, it will offer a download */}
                  <audio controls src={finalUrl} style={{ width: '100%' }} />
                  <p className="panel__hint panel__hint--muted">If this is a video container, open it from the Downloads after saving.</p>
                </div>
              ) : null}
            </div>
          ) : null}
          {audioUrl ? (
            <audio ref={audioRef} controls src={audioUrl} style={{ width: '100%' }} />
          ) : null}
          {transcript ? (
            <div>
              <p className="panel__meta">Language: {transcript.language || 'unknown'} · Duration: {transcript.duration?.toFixed?.(1) ?? transcript.duration}s</p>
              <div
                role="list"
                aria-label="Transcript words (drag to select a region)"
                style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 0', userSelect: 'none' }}
                onMouseUp={() => setIsSelecting(false)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    clearSelection();
                  }
                }}
              >
                {transcript.words?.length ? (
                  transcript.words.map((w, idx) => {
                    const a = selStartIdx ?? -1;
                    const b = selEndIdx ?? -1;
                    const lo = Math.min(a, b);
                    const hi = Math.max(a, b);
                    const selected = a !== null && b !== null && idx >= lo && idx <= hi;
                    return (
                      <span
                        key={`w-${idx}`}
                        role="listitem"
                        title={`t=${w.start.toFixed(2)}–${w.end.toFixed(2)}`}
                        className="chip"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          if (e.shiftKey && selStartIdx !== null) {
                            // Extend selection to this word
                            setSelEndIdx(idx);
                            updateRegionFromIdxRange(selStartIdx, idx);
                          } else {
                            setIsSelecting(true);
                            setSelStartIdx(idx);
                            setSelEndIdx(idx);
                            setRegionStart(w.start.toFixed(2));
                            setRegionEnd(w.end.toFixed(2));
                          }
                        }}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          setSelStartIdx(idx);
                          setSelEndIdx(idx);
                          setRegionStart(w.start.toFixed(2));
                          setRegionEnd(w.end.toFixed(2));
                          void previewSelectionOnce();
                        }}
                        onMouseEnter={() => {
                          if (isSelecting) {
                            setSelEndIdx(idx);
                            const a2 = selStartIdx ?? idx;
                            updateRegionFromIdxRange(a2, idx);
                          }
                        }}
                        style={{
                          background: selected ? 'rgba(96,165,250,0.35)' : 'rgba(148,163,184,0.15)',
                          border: selected ? '1px solid rgba(96,165,250,0.8)' : '1px solid rgba(148,163,184,0.25)',
                          padding: '3px 6px',
                          borderRadius: 8,
                          cursor: 'pointer',
                        }}
                      >
                        {w.text}
                      </span>
                    );
                  })
                ) : (
                  <p className="panel__hint panel__hint--muted">No word timings; enable WhisperX later for alignment.</p>
                )}
              </div>
              <div className="panel__actions" style={{ gap: 8 }}>
                <button
                  className="panel__button"
                  type="button"
                  onClick={() => { clearSelection(); }}
                >
                  Clear selection
                </button>
                {selStartIdx !== null && selEndIdx !== null ? (
                  <>
                    <span className="panel__meta">Selection: {regionStart || '…'}s → {regionEnd || '…'}s</span>
                    <button className="panel__button" type="button" disabled={!audioUrl || isPreviewingSel} onClick={() => void previewSelectionOnce()}>
                      {isPreviewingSel ? 'Playing…' : 'Preview selection'}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
