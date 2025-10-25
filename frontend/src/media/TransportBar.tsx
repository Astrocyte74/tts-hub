import { useEffect, useRef, useState } from 'react';

interface TransportBarProps {
  audioUrl: string | null;
  selection: { start: number | null; end: number | null };
  onSetSelection: (start: number | null, end: number | null) => void;
}

export function TransportBar({ audioUrl, selection, onSetSelection }: TransportBarProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<null | 'start' | 'end'>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onMeta = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onTime = () => setTime(el.currentTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('timeupdate', onTime);
    if (el.readyState >= 1) { onMeta(); onTime(); }
    return () => {
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('timeupdate', onTime);
    };
  }, [audioRef.current]);

  function seekToClientX(clientX: number) {
    if (!timelineRef.current || !audioRef.current || !duration) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    try { audioRef.current.currentTime = pct * duration; } catch {}
  }

  function hasValidSelection(): boolean {
    return (
      selection.start !== null && selection.end !== null &&
      Number.isFinite(selection.start) && Number.isFinite(selection.end) &&
      (selection.start as number) < (selection.end as number)
    );
  }

  function playSelectionOnce() {
    if (!hasValidSelection() || !audioRef.current) return;
    const start = selection.start as number;
    const end = selection.end as number;
    const audio = audioRef.current;
    try { audio.currentTime = start; } catch {}
    const stopAt = Math.max(start, end - 0.02);
    const onTime = () => {
      if (audio.currentTime >= stopAt) {
        audio.pause();
        audio.removeEventListener('timeupdate', onTime);
      }
    };
    audio.addEventListener('timeupdate', onTime);
    void audio.play().catch(() => audio.removeEventListener('timeupdate', onTime));
  }

  // Global keyboard shortcuts: Space = preview selection; Esc = clear; Alt/Shift + Arrows = nudge edges
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null): boolean {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName?.toLowerCase();
      return (
        tag === 'input' || tag === 'textarea' || tag === 'select' ||
        (node as HTMLElement).isContentEditable === true
      );
    }
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
        if (hasValidSelection()) {
          e.preventDefault();
          playSelectionOnce();
        }
        return;
      }
      if (e.key === 'Escape') {
        onSetSelection(null, null);
        return;
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && hasValidSelection()) {
        const step = e.shiftKey ? 0.5 : 0.05; // s
        const start = selection.start as number;
        const end = selection.end as number;
        if (e.altKey) {
          // Adjust start edge
          const delta = e.key === 'ArrowLeft' ? -step : step;
          const nextStart = Math.max(0, Math.min(end - 0.01, start + delta));
          onSetSelection(nextStart, end);
          e.preventDefault();
          return;
        }
        if (e.shiftKey) {
          // Adjust end edge
          const delta = e.key === 'ArrowLeft' ? -step : step;
          const nextEnd = Math.min(duration || Infinity, Math.max(start + 0.01, end + delta));
          onSetSelection(start, nextEnd);
          e.preventDefault();
          return;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selection.start, selection.end, duration]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragRef.current || !timelineRef.current || !duration) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const t = pct * duration;
      const start = selection.start ?? 0;
      const end = selection.end ?? duration;
      if (dragRef.current === 'start') {
        const newStart = Math.min(t, end - 0.01);
        onSetSelection(Math.max(0, newStart), end);
      } else {
        const newEnd = Math.max(t, start + 0.01);
        onSetSelection(start, Math.min(duration, newEnd));
      }
    }
    function onUp() { dragRef.current = null; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [duration, selection.start, selection.end, onSetSelection]);

  return (
    <div className="media-transport">
      <audio ref={audioRef} controls src={audioUrl ?? undefined} className="media-transport__audio" />
      <div
        ref={timelineRef}
        className="media-timeline"
        aria-label="Timeline"
        onClick={(e) => seekToClientX(e.clientX)}
      >
        {(() => {
          const s = selection.start ?? NaN; const en = selection.end ?? NaN;
          if (!duration || !Number.isFinite(s) || !Number.isFinite(en) || en <= s) return null;
          const left = `${(Math.max(0, s) / duration) * 100}%`;
          const width = `${(Math.max(0, Math.min(duration, en) - Math.max(0, s)) / duration) * 100}%`;
          return (
            <>
              <div style={{ position: 'absolute', left, width, top: 0, bottom: 0, background: 'linear-gradient(90deg,#60a5fa,#22d3ee)', opacity: 0.6, borderRadius: 6 }} />
              <div
                title="Drag to adjust start"
                role="slider"
                aria-label="Selection start"
                tabIndex={0}
                aria-valuemin={0}
                aria-valuemax={duration || 0}
                aria-valuenow={selection.start ?? 0}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 0.5 : 0.05;
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    const dir = e.key === 'ArrowLeft' ? -1 : 1;
                    const start = selection.start ?? 0;
                    const end = selection.end ?? (duration || 0);
                    const next = Math.max(0, Math.min(end - 0.01, start + dir * step));
                    onSetSelection(next, end);
                    e.preventDefault();
                  }
                }}
                onMouseDown={(e) => { e.preventDefault(); dragRef.current = 'start'; }}
                style={{ position: 'absolute', left, top: -4, width: 10, height: 16, background: '#60a5fa', borderRadius: 3, cursor: 'ew-resize', transform: 'translateX(-50%)' }}
              />
              <div
                title="Drag to adjust end"
                role="slider"
                aria-label="Selection end"
                tabIndex={0}
                aria-valuemin={0}
                aria-valuemax={duration || 0}
                aria-valuenow={selection.end ?? 0}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 0.5 : 0.05;
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    const dir = e.key === 'ArrowLeft' ? -1 : 1;
                    const start = selection.start ?? 0;
                    const end = selection.end ?? (duration || 0);
                    const next = Math.min(duration || Infinity, Math.max(start + 0.01, end + dir * step));
                    onSetSelection(start, next);
                    e.preventDefault();
                  }
                }}
                onMouseDown={(e) => { e.preventDefault(); dragRef.current = 'end'; }}
                style={{ position: 'absolute', left: `calc(${left} + ${width})`, top: -4, width: 10, height: 16, background: '#22d3ee', borderRadius: 3, cursor: 'ew-resize', transform: 'translateX(-50%)' }}
              />
            </>
          );
        })()}
        {duration ? (
          <div className="media-timeline__playhead" style={{ left: `${(time / duration) * 100}%` }} />
        ) : null}
      </div>
      <div className="media-transport__meta">
        <span>{time.toFixed(2)} / {duration.toFixed(2)}s</span>
        {Number.isFinite(selection.start ?? NaN) && Number.isFinite(selection.end ?? NaN) && selection.start! < selection.end! ? (
          <span>Selection: {(selection.end! - selection.start!).toFixed(2)}s</span>
        ) : <span />}
      </div>
    </div>
  );
}
