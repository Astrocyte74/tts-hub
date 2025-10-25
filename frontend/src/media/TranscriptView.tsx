import { useEffect, useMemo, useRef, useState } from 'react';
import type { MediaTranscriptResult } from '../types';

interface TranscriptViewProps {
  transcript: MediaTranscriptResult | null;
  selection: { start: number | null; end: number | null };
  onSelectRange: (start: number, end: number) => void;
  onPreview?: () => void;
  setOuterRef?: (el: HTMLDivElement | null) => void;
}

export function TranscriptView({ transcript, selection, onSelectRange, onPreview, setOuterRef }: TranscriptViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const CHUNK_SIZE = 200;
  const [visible, setVisible] = useState<Set<number>>(new Set([0,1,2]));
  const [measured, setMeasured] = useState<Map<number, number>>(new Map());
  const [isSelecting, setIsSelecting] = useState(false);
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const chunks = useMemo(() => {
    const items = transcript?.words ?? [];
    const out: { start: number; end: number }[] = [];
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      out.push({ start: i, end: Math.min(items.length, i + CHUNK_SIZE) });
    }
    return out;
  }, [transcript]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    if (setOuterRef) setOuterRef(root);
    const io = new IntersectionObserver(
      (entries) => {
        const next = new Set(visible);
        for (const entry of entries) {
          const idxAttr = (entry.target as HTMLElement).getAttribute('data-chunk');
          if (!idxAttr) continue;
          const idx = parseInt(idxAttr, 10);
          if (Number.isNaN(idx)) continue;
          if (entry.isIntersecting) {
            next.add(idx);
            // keep neighbors warm
            next.add(idx - 1);
            next.add(idx + 1);
          } else {
            // allow unmounting when far
            next.delete(idx - 3);
            next.delete(idx - 2);
            next.delete(idx + 2);
            next.delete(idx + 3);
          }
        }
        setVisible(next);
      },
      { root, rootMargin: '400px 0px' }
    );
    // Observe placeholders
    const nodes = Array.from(root.querySelectorAll('[data-chunk]')) as HTMLElement[];
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef.current, chunks.length]);

  // Global mouseup to end drag-select
  useEffect(() => {
    const onUp = () => setIsSelecting(false);
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  if (!transcript) return null;

  const words = transcript.words || [];
  const a = selection.start ?? -1;
  const b = selection.end ?? -1;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);

  return (
    <div className="media-surface" ref={containerRef} style={{ maxHeight: 420, overflow: 'auto' }}>
      <p className="panel__meta">Transcript · Lang: {transcript.language || 'unknown'} · {transcript.duration?.toFixed?.(1) ?? transcript.duration}s</p>
      <div role="list" aria-label="Transcript words" style={{ position: 'relative', userSelect: 'none' }}>
        {chunks.length === 0 ? (
          <p className="panel__hint panel__hint--muted">No word timings; enable WhisperX later for alignment.</p>
        ) : (
          chunks.map((chunk, i) => {
            const key = `chunk-${i}`;
            const isVisible = visible.has(i);
            const estimated = measured.get(i) ?? 140; // fallback chunk height estimate
            return (
              <div key={key} data-chunk={i} style={{ borderBottom: '1px solid rgba(148,163,184,.08)', padding: '4px 0' }}>
                {isVisible ? (
                  <div
                    ref={(el) => {
                      if (!el) return;
                      const h = el.getBoundingClientRect().height;
                      setMeasured((prev) => (prev.get(i) === h ? prev : new Map(prev).set(i, h)));
                    }}
                    style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 0' }}
                  >
                    {words.slice(chunk.start, chunk.end).map((w, idx) => {
                      const wordIndex = chunk.start + idx;
                      const selected = a !== null && b !== null && wordIndex >= lo && wordIndex <= hi;
                      return (
                        <span
                          key={`w-${wordIndex}`}
                          role="listitem"
                          title={`t=${w.start.toFixed(2)}–${w.end.toFixed(2)}`}
                          className="chip"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setIsSelecting(true);
                            setAnchorIndex(wordIndex);
                            onSelectRange(w.start, w.end);
                          }}
                          onMouseEnter={() => {
                            if (isSelecting && anchorIndex !== null) {
                              const loIdx = Math.max(0, Math.min(anchorIndex, wordIndex));
                              const hiIdx = Math.min(words.length - 1, Math.max(anchorIndex, wordIndex));
                              const loWord = (transcript.words || [])[loIdx];
                              const hiWord = (transcript.words || [])[hiIdx];
                              if (loWord && hiWord) {
                                onSelectRange(loWord.start, hiWord.end);
                              }
                            }
                          }}
                          onDoubleClick={(e) => { e.preventDefault(); onSelectRange(w.start, w.end); onPreview && onPreview(); }}
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
                    })}
                  </div>
                ) : (
                  <div style={{ height: estimated }} />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
