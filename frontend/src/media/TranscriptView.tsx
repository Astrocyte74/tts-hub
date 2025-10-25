import { useEffect } from 'react';
import type { MediaTranscriptResult } from '../types';

interface TranscriptViewProps {
  transcript: MediaTranscriptResult | null;
  selection: { start: number | null; end: number | null };
  onSelectRange: (start: number, end: number) => void;
  onPreview?: () => void;
}

export function TranscriptView({ transcript, selection, onSelectRange, onPreview }: TranscriptViewProps) {
  useEffect(() => {
    // no-op placeholder for virtualization hooks later
  }, [transcript]);

  if (!transcript) return null;

  const words = transcript.words || [];
  const a = selection.start ?? -1;
  const b = selection.end ?? -1;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);

  return (
    <div>
      <p className="panel__meta">Language: {transcript.language || 'unknown'} · Duration: {transcript.duration?.toFixed?.(1) ?? transcript.duration}s</p>
      <div
        role="list"
        aria-label="Transcript words (drag to select a region)"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 0', userSelect: 'none' }}
        onMouseUp={() => {/* allow future drag selection */}}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onSelectRange(NaN, NaN);
          }
        }}
      >
        {words.length ? (
          words.map((w, idx) => {
            const selected = a !== null && b !== null && idx >= lo && idx <= hi;
            return (
              <span
                key={`w-${idx}`}
                role="listitem"
                title={`t=${w.start.toFixed(2)}–${w.end.toFixed(2)}`}
                className="chip"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelectRange(w.start, w.end);
                }}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  onSelectRange(w.start, w.end);
                  onPreview && onPreview();
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
    </div>
  );
}

