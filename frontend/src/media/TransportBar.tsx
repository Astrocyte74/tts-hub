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
                onMouseDown={(e) => { e.preventDefault(); dragRef.current = 'start'; }}
                style={{ position: 'absolute', left, top: -4, width: 10, height: 16, background: '#60a5fa', borderRadius: 3, cursor: 'ew-resize', transform: 'translateX(-50%)' }}
              />
              <div
                title="Drag to adjust end"
                role="slider"
                aria-label="Selection end"
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
