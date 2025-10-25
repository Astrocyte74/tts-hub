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
  diffMarkers?: { idx: number; boundary: 'start'|'end'; prev: number; next: number; deltaMs: number }[];
  showLegend?: boolean;
}

export function WaveformCanvas({ audioUrl, words, currentTime, selection, onChangeSelection, height = 80, diffMarkers = [], showLegend = true }: Props) {
  const { peaks, duration } = useWaveformData(audioUrl, 1024);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(600);
  const dpr = Math.max(1, Math.min(2, (window.devicePixelRatio || 1)));
  const [hover, setHover] = useState<{ x: number; t: number; idx: number } | null>(null);

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
      ctx.fillStyle = 'rgba(226,232,240,0.55)';
      for (const wd of words) {
        const xs = Math.floor(timeToX(wd.start) * dpr);
        const xe = Math.floor(timeToX(wd.end) * dpr);
        ctx.fillRect(xs, 0, 1, h);
        ctx.fillRect(xe, 0, 1, h);
      }
    }

    // Whiskers for boundary adjustments (last alignment)
    if (diffMarkers && diffMarkers.length && duration) {
      ctx.strokeStyle = 'rgba(237,137,54,0.9)'; // orange
      ctx.fillStyle = 'rgba(237,137,54,0.9)';
      ctx.lineWidth = Math.max(1, Math.floor(1 * dpr));
      for (const mk of diffMarkers) {
        const tNow = mk.next;
        const xNow = Math.floor(timeToX(tNow) * dpr);
        const dx = (mk.next - mk.prev) / duration * (width * dpr);
        // clamp visual length in px (accounting for sign)
        const maxLen = 8 * dpr;
        const minLen = 2 * dpr;
        let dxPx = dx;
        const sign = dxPx >= 0 ? 1 : -1;
        dxPx = Math.min(maxLen, Math.max(-maxLen, dxPx));
        if (Math.abs(dxPx) < minLen) dxPx = sign * minLen; // ensure visible
        const yMid = Math.floor(h * 0.2); // draw near the top
        ctx.beginPath();
        ctx.moveTo(xNow, yMid - 3);
        ctx.lineTo(xNow - dxPx, yMid - 3);
        ctx.stroke();
        // end cap
        ctx.fillRect(Math.floor(xNow - dxPx - (1 * dpr)), yMid - 5, Math.max(2, Math.floor(2 * dpr)), Math.max(4, Math.floor(4 * dpr)));
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
      onPointerMove={(e) => {
        if (!containerRef.current || !duration) return;
        // Hover preview (nearest word + time)
        const rect = containerRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const t = Math.max(0, Math.min(duration, (x / rect.width) * duration));
        // find nearest word by interval distance
        let idx = -1; let best = Infinity;
        if (words && words.length) {
          for (let i = 0; i < words.length; i += 1) {
            const w = words[i]!;
            const d = t >= w.start && t <= w.end ? 0 : Math.min(Math.abs(t - w.start), Math.abs(t - w.end));
            if (d < best) { best = d; idx = i; }
          }
        }
        setHover({ x, t, idx });
      }}
      onPointerLeave={() => setHover(null)}
      title={duration ? `${duration.toFixed(2)}s` : undefined}
    >
      <canvas ref={canvasRef} />
      {/* Hover tooltip */}
      {hover && hover.idx >= 0 && words && words[hover.idx] ? (() => {
        const w = words[hover.idx]!;
        const map: Record<number, { startDelta?: number; endDelta?: number }> = {};
        for (const mk of diffMarkers) {
          const m = map[mk.idx] || (map[mk.idx] = {});
          if (mk.boundary === 'start') m.startDelta = mk.deltaMs;
          else m.endDelta = mk.deltaMs;
        }
        const dm = map[hover.idx];
        const sd = typeof dm?.startDelta === 'number' ? `${dm!.startDelta! >= 0 ? '+' : ''}${Math.round(dm!.startDelta!)}ms` : '';
        const ed = typeof dm?.endDelta === 'number' ? `${dm!.endDelta! >= 0 ? '+' : ''}${Math.round(dm!.endDelta!)}ms` : '';
        const label = `${w.text} · t=${hover.t.toFixed(2)}s${sd || ed ? ` · Δ ${[sd, ed].filter(Boolean).join(' / ')}` : ''}`;
        const left = Math.max(6, Math.min(width - 6, hover.x));
        return (
          <div className="waveform__tooltip" style={{ left, top: 8 }} role="tooltip" aria-label={label}>
            {label}
          </div>
        );
      })() : null}
      {/* Legend */}
      {showLegend ? (
        <div className="waveform__legend" aria-hidden>
          <span className="wave-legend__item"><i className="wl wl--env" /> Envelope</span>
          <span className="wave-legend__item"><i className="wl wl--tick" /> Word boundary</span>
          <span className="wave-legend__item"><i className="wl wl--sel" /> Selection</span>
          <span className="wave-legend__item"><i className="wl wl--whisk" /> Adjustment</span>
          <span className="wave-legend__item"><i className="wl wl--play" /> Playhead</span>
        </div>
      ) : null}
    </div>
  );
}
