import { useEffect, useMemo, useState } from 'react';
import { TranscriptPanel } from '../components/TranscriptPanel';
import { ResultsDrawer } from '../components/ResultsDrawer';
import { useSessionStorage } from '../hooks/useSessionStorage';
import type { SynthesisResult } from '../types';

type QueueItem = {
  id: string;
  label: string;
  engine: string;
  status: 'pending' | 'rendering' | 'done' | 'error' | 'canceled';
  progress?: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

export function MediaEditorPage() {
  const [queue, setQueue] = useSessionStorage<QueueItem[]>('kokoro:queue.v1', []);
  const [results, setResults] = useSessionStorage<SynthesisResult[]>('kokoro:history.v1', []);
  const activeCount = useMemo(() => queue.filter((q) => q.status === 'pending' || q.status === 'rendering').length, [queue]);
  const [drawerOpen, setDrawerOpen] = useState(activeCount > 0);
  useEffect(() => {
    document.title = 'Kokoro Media Editor';
    return () => { /* no-op */ };
  }, []);
  useEffect(() => {
    if (activeCount > 0) setDrawerOpen(true);
  }, [activeCount]);

  return (
    <div className="panel" style={{ padding: 16 }}>
      <header className="panel__header" style={{ justifyContent: 'space-between' }}>
        <div className="panel__heading">
          <h2 className="panel__title">Media Editor</h2>
          <p className="panel__subtitle">Transcribe, align, replace dialogue, and export.</p>
        </div>
        <div className="panel__actions">
          <button className="panel__button" type="button" onClick={() => setDrawerOpen((v) => !v)}>
            {drawerOpen ? 'Hide' : 'Show'} Results
          </button>
          <button className="panel__button" type="button" onClick={() => { try { window.location.hash = ''; } catch {} }}>Back to Playground</button>
        </div>
      </header>
      <TranscriptPanel />
      <ResultsDrawer
        open={drawerOpen}
        onToggle={() => setDrawerOpen((v) => !v)}
        items={results}
        queue={queue}
        autoPlay={false}
        onRemove={(id) => setResults((prev) => prev.filter((r) => r.id !== id))}
        onClearQueue={() => setQueue([])}
        onClearHistory={() => setResults([])}
      />
    </div>
  );
}
