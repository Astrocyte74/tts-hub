import { useEffect, useMemo, useRef, useState } from 'react';
import { useWaveformData } from '../hooks/useWaveformData';

type Word = { text: string; start: number; end: number };

interface Props {
  audioUrl: string | null;
  words: Word[] | null;
  currentTime: number;
  selection: { start: number; end: number } | null;
  onChangeSelection?: (start: number, end: number) => void;
  height?: number;
}

export function WaveformCanvas({ audioUrl, words, currentTime, selection, onChangeSelection, height = 80 }: Props) {
  const { peaks, duration } = useWaveformData(audioUrl, 1024);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(600);
  const dpr = Math.max(1, Math.min(2, (window.devicePixelRatio || 1)));

  // Resize observer to keep canvas crisp
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.max(200, Math.floor(e.contentRect.width));
        setWidth(w);
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const timeToX = useMemo(() => (
    (t: number) => {
      if (!duration) return 0;
      return Math.max(0, Math.min(width, (t / duration) * width));
    }
  ), [duration, width]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = Math.floor(width * dpr);
    const h = Math.floor(height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Clear
    ctx.clearRect(0, 0, w, h);
    // Background
    ctx.fillStyle = 'rgba(148,163,184,0.18)';
    ctx.fillRect(0, 0, w, h);

    // Selection
    if (selection && selection.end > selection.start && duration) {
      const x0 = Math.floor(timeToX(selection.start) * dpr);
      const x1 = Math.floor(timeToX(selection.end) * dpr);
      ctx.fillStyle = 'rgba(96,165,250,0.35)';
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
    }

    // Envelope
    if (peaks && peaks.length) {
      const n = peaks.length;
      ctx.fillStyle = 'rgba(59,130,246,0.8)';
      const center = Math.floor(h / 2);
      for (let i = 0; i < n; i += 1) {
        const v = peaks[i];
        const x = Math.floor((i / (n - 1)) * w);
        const y = Math.floor(v * (h / 2 - 2));
        ctx.fillRect(x, center - y, 1, y * 2);
      }
    }

    // Word boundary ticks
    if (words && words.length && duration) {
      ctx.fillStyle = 'rgba(226,232,240,0.7)';
      for (const wd of words) {
        const xs = Math.floor(timeToX(wd.start) * dpr);
        const xe = Math.floor(timeToX(wd.end) * dpr);
        ctx.fillRect(xs, 0, 1, h);
        ctx.fillRect(xe, 0, 1, h);
      }
    }

    // Playhead
    if (duration && Number.isFinite(currentTime)) {
      const x = Math.floor(timeToX(currentTime) * dpr);
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(x, 0, 2, h);
    }
  }, [peaks, duration, width, height, dpr, selection, words, currentTime, timeToX]);

  // Interaction: click/drag to select, snap on release
  const dragRef = useRef<{ from: number; to: number } | null>(null);

  function posToTime(clientX: number): number {
    if (!containerRef.current || !duration) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return pct * duration;
  }

  function snapToWords(t: number, bound: 'start' | 'end'): number {
    if (!words || !words.length) return t;
    let nearest = words[0]!.start;
    let best = Infinity;
    for (const w of words) {
      const v = bound === 'start' ? w.start : w.end;
      const d = Math.abs(v - t);
      if (d < best) { best = d; nearest = v; }
    }
    return nearest;
  }

  return (
    <div
      className="waveform"
      ref={containerRef}
      onMouseDown={(e) => {
        const t = posToTime(e.clientX);
        dragRef.current = { from: t, to: t };
      }}
      onMouseMove={(e) => {
        if (!dragRef.current) return;
        dragRef.current.to = posToTime(e.clientX);
        const a = Math.min(dragRef.current.from, dragRef.current.to);
        const b = Math.max(dragRef.current.from, dragRef.current.to);
        onChangeSelection && onChangeSelection(a, b);
      }}
      onMouseUp={(e) => {
        if (!dragRef.current) return;
        const a = Math.min(dragRef.current.from, dragRef.current.to);
        const b = Math.max(dragRef.current.from, dragRef.current.to);
        dragRef.current = null;
        const s = snapToWords(a, 'start');
        const e2 = snapToWords(b, 'end');
        onChangeSelection && onChangeSelection(s, e2);
      }}
      title={duration ? `${duration.toFixed(2)}s` : undefined}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}

