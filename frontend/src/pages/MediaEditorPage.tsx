import { useEffect } from 'react';
import { TranscriptPanel } from '../components/TranscriptPanel';

export function MediaEditorPage() {
  useEffect(() => {
    document.title = 'Kokoro Media Editor';
    return () => { /* no-op */ };
  }, []);

  return (
    <div className="panel" style={{ padding: 16 }}>
      <header className="panel__header" style={{ justifyContent: 'space-between' }}>
        <div className="panel__heading">
          <h2 className="panel__title">Media Editor</h2>
          <p className="panel__subtitle">Transcribe, align, replace dialogue, and export.</p>
        </div>
        <div className="panel__actions">
          <button className="panel__button" type="button" onClick={() => { try { window.location.hash = ''; } catch {} }}>Back to Playground</button>
        </div>
      </header>
      <TranscriptPanel />
    </div>
  );
}

