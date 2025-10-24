import { useRef, useState } from 'react';
import { mediaAlignFull, mediaAlignRegion, mediaTranscribeFromUrl, mediaTranscribeUpload } from '../api/client';
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
  const [transcript, setTranscript] = useState<MediaTranscriptResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
                  }
                }}
              >
                {busy ? 'Aligning…' : 'Refine region'}
              </button>
            </div>
          ) : null}
          {audioUrl ? (
            <audio controls src={audioUrl} style={{ width: '100%' }} />
          ) : null}
          {transcript ? (
            <div>
              <p className="panel__meta">Language: {transcript.language || 'unknown'} · Duration: {transcript.duration?.toFixed?.(1) ?? transcript.duration}s</p>
              <div role="list" aria-label="Transcript words" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 0' }}>
                {transcript.words?.length ? (
                  transcript.words.map((w, idx) => (
                    <span
                      key={`w-${idx}`}
                      role="listitem"
                      title={`t=${w.start.toFixed(2)}–${w.end.toFixed(2)}`}
                      className="chip"
                      style={{ background: 'rgba(148,163,184,0.15)', border: '1px solid rgba(148,163,184,0.25)', padding: '3px 6px', borderRadius: 8 }}
                    >
                      {w.text}
                    </span>
                  ))
                ) : (
                  <p className="panel__hint panel__hint--muted">No word timings; enable WhisperX later for alignment.</p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
