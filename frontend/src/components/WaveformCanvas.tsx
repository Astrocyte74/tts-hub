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
  defaultZoom?: number;
}

export function WaveformCanvas({ audioUrl, words, currentTime, selection, onChangeSelection, height = 80, diffMarkers = [], showLegend = true, defaultZoom = 1 }: Props) {
  const { peaks, duration } = useWaveformData(audioUrl, 1024);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(600);
  const dpr = Math.max(1, Math.min(2, (window.devicePixelRatio || 1)));
  const [hover, setHover] = useState<{ x: number; t: number; idx: number } | null>(null);
  const [zoom, setZoom] = useState<number>(Math.max(1, defaultZoom || 1)); // 1 = fit all
  const [viewStart, setViewStart] = useState<number>(0); // seconds
  const [isHot, setIsHot] = useState<boolean>(false); // keyboard scope when hovered
  const [styleMode, setStyleMode] = useState<'bars' | 'line'>('bars');

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

  const viewDuration = useMemo(() => {
    if (!duration || zoom <= 0) return duration || 0;
    return Math.max(0.01, duration / zoom);
  }, [duration, zoom]);

  const clampViewStart = (start: number) => {
    if (!duration) return 0;
    const maxStart = Math.max(0, duration - viewDuration);
    return Math.max(0, Math.min(maxStart, start));
  };

  useEffect(() => { setViewStart((s) => clampViewStart(s)); }, [viewDuration]);

  const timeToX = useMemo(() => (
    (t: number) => {
      if (!duration) return 0;
      const rel = (t - viewStart) / viewDuration;
      return Math.max(0, Math.min(width, rel * width));
    }
  ), [duration, width, viewStart, viewDuration]);

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

    // Envelope — render only the visible subset
    if (peaks && peaks.length && duration) {
      const center = Math.floor(h / 2);
      const n = peaks.length;
      const startIdx = Math.max(0, Math.floor(((viewStart) / duration) * (n - 1)));
      const endIdx = Math.min(n - 1, Math.ceil(((viewStart + viewDuration) / duration) * (n - 1)));
      const span = Math.max(1, endIdx - startIdx);
      if (styleMode === 'bars') {
        ctx.fillStyle = 'rgba(59,130,246,0.8)';
        for (let i = startIdx; i <= endIdx; i += 1) {
          const v = peaks[i];
          const rel = (i - startIdx) / span;
          const x = Math.floor(rel * w);
          const y = Math.floor(v * (h / 2 - 2));
          ctx.fillRect(x, center - y, 1, y * 2);
        }
      } else {
        // line mode
        ctx.strokeStyle = 'rgba(59,130,246,0.95)';
        ctx.lineWidth = Math.max(1, Math.floor(1 * dpr));
        ctx.beginPath();
        for (let i = startIdx; i <= endIdx; i += 1) {
          const v = peaks[i];
          const rel = (i - startIdx) / span;
          const x = Math.floor(rel * w);
          const y = Math.floor(v * (h / 2 - 2));
          const yy = center - y; // top line
          if (i === startIdx) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
        // mirror line for symmetry
        ctx.beginPath();
        for (let i = startIdx; i <= endIdx; i += 1) {
          const v = peaks[i];
          const rel = (i - startIdx) / span;
          const x = Math.floor(rel * w);
          const y = Math.floor(v * (h / 2 - 2));
          const yy = center + y; // bottom line
          if (i === startIdx) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    }

    // Word boundary ticks
    if (words && words.length && duration) {
      ctx.fillStyle = 'rgba(226,232,240,0.55)';
      for (const wd of words) {
        // only draw when inside view
        if (wd.end < viewStart || wd.start > (viewStart + viewDuration)) continue;
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
        if (tNow < viewStart || tNow > (viewStart + viewDuration)) continue;
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

  // Minimap draw (full duration)
  useEffect(() => {
    const cv = miniRef.current;
    if (!cv) return;
    const mh = Math.floor(16 * dpr);
    const mw = Math.floor(width * dpr);
    if (cv.width !== mw || cv.height !== mh) {
      cv.width = mw; cv.height = mh; cv.style.width = `${width}px`; cv.style.height = `16px`;
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, mw, mh);
    ctx.fillStyle = 'rgba(30,41,59,0.6)';
    ctx.fillRect(0, 0, mw, mh);
    if (peaks && peaks.length && duration) {
      ctx.fillStyle = 'rgba(59,130,246,0.7)';
      const n = peaks.length;
      for (let i = 0; i < n; i += 1) {
        const v = peaks[i];
        const x = Math.floor((i / (n - 1)) * mw);
        const y = Math.floor(v * (mh - 2));
        ctx.fillRect(x, mh - 2 - y, 1, y);
      }
      // viewport window
      if (viewDuration > 0) {
        const x0 = Math.floor((viewStart / duration) * mw);
        const x1 = Math.floor(((viewStart + viewDuration) / duration) * mw);
        ctx.strokeStyle = 'rgba(226,232,240,0.9)';
        ctx.lineWidth = Math.max(1, Math.floor(1 * dpr));
        ctx.strokeRect(x0, 1, Math.max(2, x1 - x0), mh - 2);
        ctx.fillStyle = 'rgba(226,232,240,0.12)';
        ctx.fillRect(x0, 1, Math.max(2, x1 - x0), mh - 2);
      }
    }
  }, [peaks, duration, width, dpr, viewStart, viewDuration]);

  // Minimap interactions
  function miniPosToStart(clientX: number): number {
    if (!miniRef.current || !duration) return 0;
    const rect = miniRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    // center the view on click
    let start = (pct * duration) - viewDuration / 2;
    return clampViewStart(start);
  }

  const miniDrag = useRef<boolean>(false);

  // Interaction: click/drag to select, snap on release
  const dragRef = useRef<{ from: number; to: number } | null>(null);

  function posToTime(clientX: number): number {
    if (!containerRef.current || !duration) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return viewStart + pct * viewDuration;
  }

  // Keyboard shortcuts (when hovered): Z in, Shift+Z out, F fit, S zoom to selection
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!isHot) return;
      const target = e.target as HTMLElement | null;
      const tag = (target?.tagName || '').toLowerCase();
      const isEditable = tag === 'input' || tag === 'textarea' || (target && (target as HTMLElement).isContentEditable);
      if (isEditable) return;
      if (e.key.toLowerCase() === 'z' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        // zoom in at center of current view or selection center
        const anchor = selection ? (selection.start + selection.end) / 2 : (viewStart + viewDuration / 2);
        const factor = e.shiftKey ? 1 / 1.2 : 1.2; // Shift+Z to zoom out
        const nextZoom = Math.max(1, Math.min(100, zoom * factor));
        const nextViewDur = Math.max(0.01, duration ? duration / nextZoom : viewDuration);
        let nextStart = anchor - nextViewDur / 2;
        nextStart = clampViewStart(nextStart);
        setZoom(nextZoom);
        setViewStart(nextStart);
      } else if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setZoom(1); setViewStart(0);
      } else if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!selection || !duration) return;
        e.preventDefault();
        const len = Math.max(0.01, selection.end - selection.start);
        const nextZoom = Math.min(100, duration / len);
        setZoom(nextZoom);
        setViewStart(clampViewStart(selection.start - 0.05 * len));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isHot, selection, zoom, duration, viewStart, viewDuration]);

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

  function isInUi(target: EventTarget | null): boolean {
    if (!(target instanceof Element) || !containerRef.current) return false;
    const controls = containerRef.current.querySelector('.waveform__controls');
    const footer = containerRef.current.querySelector('.waveform__footer');
    return Boolean((controls && controls.contains(target)) || (footer && footer.contains(target)));
  }

  return (
    <div
      className="waveform"
      ref={containerRef}
      onMouseEnter={() => setIsHot(true)}
      onMouseLeave={() => { setIsHot(false); setHover(null); }}
      onMouseDown={(e) => {
        if (isInUi(e.target)) return;
        const t = posToTime(e.clientX);
        dragRef.current = { from: t, to: t };
      }}
      onMouseMove={(e) => {
        if (!dragRef.current || isInUi(e.target)) return;
        dragRef.current.to = posToTime(e.clientX);
        const a = Math.min(dragRef.current.from, dragRef.current.to);
        const b = Math.max(dragRef.current.from, dragRef.current.to);
        onChangeSelection && onChangeSelection(a, b);
      }}
      onMouseUp={(e) => {
        if (!dragRef.current || isInUi(e.target)) return;
        const a = Math.min(dragRef.current.from, dragRef.current.to);
        const b = Math.max(dragRef.current.from, dragRef.current.to);
        dragRef.current = null;
        const s = snapToWords(a, 'start');
        const e2 = snapToWords(b, 'end');
        onChangeSelection && onChangeSelection(s, e2);
      }}
      onWheel={(e) => {
        if (!duration) return;
        e.preventDefault();
        const rect = containerRef.current!.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const anchorT = viewStart + (x / rect.width) * viewDuration;
        if (e.ctrlKey || e.metaKey) {
          // Zoom towards anchor
          const factor = Math.exp(-e.deltaY * 0.0015);
          const nextZoom = Math.max(1, Math.min(100, zoom * factor));
          const nextViewDur = Math.max(0.01, duration / nextZoom);
          let nextStart = anchorT - (x / rect.width) * nextViewDur;
          nextStart = clampViewStart(nextStart);
          setZoom(nextZoom);
          setViewStart(nextStart);
        } else {
          // Pan
          const panSec = (e.deltaY / 240) * viewDuration; // mouse delta scaling
          setViewStart((s) => clampViewStart(s + panSec));
        }
      }}
      onPointerMove={(e) => {
        if (isInUi(e.target)) { setHover(null); return; }
        if (!containerRef.current || !duration) return;
        // Hover preview (nearest word + time)
        const rect = containerRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const t = Math.max(viewStart, Math.min(viewStart + viewDuration, viewStart + (x / rect.width) * viewDuration));
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
      {/* Zoom controls */}
      <div className="waveform__controls" aria-label="Waveform zoom controls">
        <button type="button" className="wf-btn" onClick={() => { setZoom((z) => Math.max(1, z / 1.5)); }}>−</button>
        <button type="button" className="wf-btn" onClick={() => { setZoom(1); setViewStart(0); }}>Fit</button>
        <button type="button" className="wf-btn" onClick={() => { if (selection && duration) { const len = Math.max(0.01, selection.end - selection.start); const nextZoom = Math.min(100, duration / len); setZoom(nextZoom); setViewStart(clampViewStart(selection.start - 0.05 * len)); } }} disabled={!selection || !(selection.end > selection.start)}>Sel</button>
        <button type="button" className="wf-btn" onClick={() => { setZoom((z) => Math.min(100, z * 1.5)); }}>+</button>
        <div className="wf-seg" role="radiogroup" aria-label="Waveform style">
          <button type="button" className={`wf-btn ${styleMode === 'bars' ? 'is-active' : ''}`} onClick={() => setStyleMode('bars')} title="Bars">Bars</button>
          <button type="button" className={`wf-btn ${styleMode === 'line' ? 'is-active' : ''}`} onClick={() => setStyleMode('line')} title="Line">Line</button>
        </div>
      </div>
      {/* Footer: shortcuts and legend */}
      <div className="waveform__footer">
        <div className="waveform__shortcuts">
          <span>Scroll to pan; Cmd/Ctrl+Scroll to zoom.</span>
          <span>Shortcuts: Z in, Shift+Z out, F fit, S selection.</span>
        </div>
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
      {/* Minimap overview (panning) */}
      <div className="waveform__minimap"
        onMouseDown={(e) => { if (!duration) return; setViewStart(miniPosToStart(e.clientX)); miniDrag.current = true; }}
        onMouseMove={(e) => { if (!duration || !miniDrag.current) return; setViewStart(miniPosToStart(e.clientX)); }}
        onMouseUp={() => { miniDrag.current = false; }}
        onMouseLeave={() => { miniDrag.current = false; }}
        aria-label="Audio overview"
      >
        <canvas ref={miniRef} />
      </div>
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
      {/* (legend rendered in footer) */}
    </div>
  );
}
