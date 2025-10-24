import { useRef, useState } from 'react';
import { mediaAlignFull, mediaTranscribeFromUrl, mediaTranscribeUpload } from '../api/client';
import type { MediaTranscriptResult } from '../types';

export function TranscriptPanel() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [whisperxEnabled, setWhisperxEnabled] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<MediaTranscriptResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleTranscribe(kind: 'url' | 'file') {
    try {
      setBusy(true);
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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transcription failed');
    } finally {
      setBusy(false);
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
          {whisperxEnabled ? (
            <div className="panel__actions" style={{ gap: 8 }}>
              <button className="panel__button" type="button" disabled={busy || !jobId} onClick={handleAlignFull}>
                {busy ? 'Aligning…' : 'Refine timings (WhisperX)'}
              </button>
              {!jobId ? <p className="panel__hint panel__hint--muted">Transcribe first to create a job.</p> : null}
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
  async function handleAlignFull() {
    if (!jobId) {
      setError('Transcribe first to create a job');
      return;
    }
    try {
      setBusy(true);
      setError(null);
      const res = await mediaAlignFull(jobId);
      setTranscript(res.transcript);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Alignment failed');
    } finally {
      setBusy(false);
    }
  }
