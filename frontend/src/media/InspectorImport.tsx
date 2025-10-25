import { useState } from 'react';

interface Props {
  busy: boolean;
  status: string;
  error: string | null;
  onTranscribeUrl: (url: string) => void;
  onTranscribeFile: (file: File) => void;
}

export function InspectorImport({ busy, status, error, onTranscribeUrl, onTranscribeFile }: Props) {
  const [mode, setMode] = useState<'youtube' | 'file'>('youtube');
  const [url, setUrl] = useState('');

  return (
    <div className="panel media-card">
      <div className="panel__heading"><h3 className="panel__title">Import Media</h3></div>
      <div className="panel__actions panel__actions--wrap" style={{ gap: 8 }}>
        <div role="group" aria-label="Source" className="panel__actions" style={{ gap: 8 }}>
          <button className="panel__button" aria-pressed={mode==='youtube'} onClick={() => setMode('youtube')}>YouTube</button>
          <button className="panel__button" aria-pressed={mode==='file'} onClick={() => setMode('file')}>File</button>
        </div>
        {mode === 'youtube' ? (
          <>
            <label className="field" style={{ minWidth: 260 }}>
              <span className="field__label">YouTube URL</span>
              <input type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
            <button className="panel__button panel__button--primary" type="button" disabled={busy || !url.trim()} onClick={() => onTranscribeUrl(url.trim())}>
              {busy ? 'Working…' : 'Transcribe'}
            </button>
          </>
        ) : (
          <>
            <label className="field">
              <span className="field__label">Upload file</span>
              <input type="file" accept="audio/*,video/*,.mp4,.mkv,.mov,.mp3,.wav,.flac,.ogg" onChange={(e) => { const f = e.target.files?.[0]; if (f) onTranscribeFile(f); }} />
            </label>
            <p className="panel__hint panel__hint--muted">Supported: mp4, mkv, mov, wav, mp3, flac, ogg</p>
          </>
        )}
      </div>
      {error ? <p className="panel__hint panel__hint--warning">{error}</p> : null}
      {status ? <p className="panel__hint panel__hint--notice" aria-live="polite">{busy ? '⏳ ' : ''}{status}</p> : null}
    </div>
  );
}
