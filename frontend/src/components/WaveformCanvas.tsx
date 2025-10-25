import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useSessionStorage } from '../hooks/useSessionStorage';
import { useWaveformData } from '../hooks/useWaveformData';

type Word = { text: string; start: number; end: number };
type ReplacementWord = { text: string; start: number; end: number };

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
  replaceWords?: ReplacementWord[] | null; // optional overlay lane (absolute times)
  persistKey?: string; // jobId for per-job persistence
}

export interface WaveformHandle {
  fit(): void;
  zoomToSelection(start: number, end: number): void;
}

export const WaveformCanvas = forwardRef<WaveformHandle, Props>(function WaveformCanvas(
  { audioUrl, words, currentTime, selection, onChangeSelection, height = 80, diffMarkers = [], showLegend = true, defaultZoom = 1, replaceWords = null, persistKey }: Props,
  ref
) {
  const { peaks, duration } = useWaveformData(audioUrl, 1024);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(600);
  const dpr = Math.max(1, Math.min(2, (window.devicePixelRatio || 1)));
  const [hover, setHover] = useState<{ x: number; t: number; idx: number } | null>(null);
  const prefix = `kokoro:wf:${persistKey || 'global'}`;
  const [zoom, setZoom] = useSessionStorage<number>(`${prefix}:zoom`, Math.max(1, defaultZoom || 1)); // 1 = fit all
  const [viewStart, setViewStart] = useSessionStorage<number>(`${prefix}:start`, 0); // seconds
  const [isHot, setIsHot] = useState<boolean>(false); // keyboard scope when hovered
  const [styleMode, setStyleMode] = useSessionStorage<'bars' | 'line' | 'filled'>(`${prefix}:style`, 'filled');
  const [showTicks, setShowTicks] = useSessionStorage<boolean>(`${prefix}:ticks`, false);
  const [showWhiskers, setShowWhiskers] = useSessionStorage<boolean>(`${prefix}:whisk`, true);
  const [showBlocks, setShowBlocks] = useSessionStorage<boolean>(`${prefix}:blocks`, false);
  const [showRepl, setShowRepl] = useSessionStorage<boolean>(`${prefix}:repl`, true);
  const [showDelta, setShowDelta] = useSessionStorage<boolean>(`${prefix}:delta`, true);
  const [blockGap, setBlockGap] = useSessionStorage<number>(`${prefix}:blockGap`, 0.25); // seconds gap to split blocks

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

  useImperativeHandle(ref, () => ({
    fit() {
      setZoom(1); setViewStart(0);
    },
    zoomToSelection(start: number, end: number) {
      if (!duration) return;
      const len = Math.max(0.01, end - start);
      const nextZoom = Math.min(100, duration / len);
      setZoom(nextZoom);
      setViewStart(clampViewStart(start - 0.05 * len));
    },
  }), [duration, clampViewStart]);

  function setZoomAnchored(newZoom: number, anchorT?: number) {
    if (!duration) return;
    const nz = Math.max(1, Math.min(100, newZoom));
    const vd = Math.max(0.01, duration / nz);
    const anchor = typeof anchorT === 'number' ? anchorT : (selection ? (selection.start + selection.end) / 2 : (viewStart + viewDuration / 2));
    let ns = clampViewStart(anchor - vd / 2);
    setZoom(nz);
    setViewStart(ns);
  }

  const timeToX = useMemo(() => (
    (t: number) => {
      if (!duration) return 0;
      const rel = (t - viewStart) / viewDuration;
      return Math.max(0, Math.min(width, rel * width));
    }
  ), [duration, width, viewStart, viewDuration]);

  // Derived speech blocks from words
  const blocks = useMemo(() => {
    if (!words || !words.length) return [] as { start: number; end: number }[];
    const out: { start: number; end: number }[] = [];
    let s = Number(words[0]!.start) || 0;
    let e = Number(words[0]!.end) || 0;
    for (let i = 1; i < words.length; i += 1) {
      const w = words[i]!;
      const ws = Number(w.start) || 0; const we = Number(w.end) || 0;
      if (ws - e > blockGap) { out.push({ start: s, end: e }); s = ws; e = we; }
      else { e = Math.max(e, we); }
    }
    out.push({ start: s, end: e });
    return out;
  }, [words, blockGap]);

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

    // Speech blocks overlay (behind envelope)
    if (showBlocks && blocks.length && duration) {
      ctx.fillStyle = 'rgba(96,165,250,0.18)';
      for (const b of blocks) {
        if (b.end < viewStart || b.start > (viewStart + viewDuration)) continue;
        const xs = Math.floor(timeToX(Math.max(b.start, viewStart)) * dpr);
        const xe = Math.floor(timeToX(Math.min(b.end, viewStart + viewDuration)) * dpr);
        ctx.fillRect(xs, 0, Math.max(1, xe - xs), h);
      }
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
      } else if (styleMode === 'line') {
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
      } else {
        // filled area mode (top and bottom mirrored)
        ctx.fillStyle = 'rgba(59,130,246,0.35)';
        const path = new Path2D();
        // top line left->right
        for (let i = startIdx; i <= endIdx; i += 1) {
          const v = peaks[i];
          const rel = (i - startIdx) / span;
          const x = Math.floor(rel * w);
          const y = Math.floor(v * (h / 2 - 2));
          const yy = center - y;
          if (i === startIdx) path.moveTo(x, yy);
          else path.lineTo(x, yy);
        }
        // bottom line right->left
        for (let i = endIdx; i >= startIdx; i -= 1) {
          const v = peaks[i];
          const rel = (i - startIdx) / span;
          const x = Math.floor(rel * w);
          const y = Math.floor(v * (h / 2 - 2));
          const yy = center + y;
          path.lineTo(x, yy);
        }
        path.closePath();
        ctx.fill(path);
      }
    }

    // Word boundary ticks
    if (showTicks && words && words.length && duration) {
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
    if (showWhiskers && diffMarkers && diffMarkers.length && duration) {
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

    // Replacement words overlay (lane under ticks)
    if (showRepl && replaceWords && replaceWords.length && duration) {
      ctx.fillStyle = 'rgba(250,204,21,0.6)'; // amber lane
      const laneTop = Math.floor(h * 0.70);
      const laneH = Math.floor(h * 0.20);
      for (const rw of replaceWords) {
        if (rw.end < viewStart || rw.start > (viewStart + viewDuration)) continue;
        const xs = Math.floor(timeToX(Math.max(rw.start, viewStart)) * dpr);
        const xe = Math.floor(timeToX(Math.min(rw.end, viewStart + viewDuration)) * dpr);
        ctx.fillRect(xs, laneTop, Math.max(1, xe - xs), laneH);
      }
    }

    // Delta between replacement boundaries and nearest original boundaries
    if (showRepl && showDelta && replaceWords && replaceWords.length && words && words.length && duration) {
      const boundaries: number[] = [];
      for (const w of words) { boundaries.push(Number(w.start)||0, Number(w.end)||0); }
      boundaries.sort((a,b)=>a-b);
      const findNearest = (t: number) => {
        // binary search could be used; linear is fine given counts
        let best = boundaries[0] ?? 0; let d = Math.abs(best - t);
        for (const b of boundaries) { const dd = Math.abs(b - t); if (dd < d) { d = dd; best = b; } }
        return {nearest: best, delta: t - best};
      };
      const drawDelta = (t: number, delta: number) => {
        const xNow = Math.floor(timeToX(t) * dpr);
        const dxPx = Math.max(2, Math.min(10, Math.abs(delta) / duration * (width * dpr)));
        const sign = delta >= 0 ? 1 : -1;
        ctx.strokeStyle = 'rgba(167,139,250,0.95)'; // violet
        ctx.fillStyle = 'rgba(167,139,250,0.95)';
        ctx.lineWidth = Math.max(1, Math.floor(1 * dpr));
        const y = Math.floor(h * 0.12);
        ctx.beginPath();
        ctx.moveTo(xNow, y);
        ctx.lineTo(xNow + sign * dxPx, y);
        ctx.stroke();
        ctx.fillRect(Math.floor(xNow + sign * dxPx - 1*dpr), y-2, 2, 4);
      };
      const thresh = 0.08; // seconds
      for (const rw of replaceWords) {
        if (rw.start >= viewStart && rw.start <= viewStart + viewDuration) {
          const { delta } = findNearest(rw.start);
          if (Math.abs(delta) > thresh) drawDelta(rw.start, delta);
        }
        if (rw.end >= viewStart && rw.end <= viewStart + viewDuration) {
          const { delta } = findNearest(rw.end);
          if (Math.abs(delta) > thresh) drawDelta(rw.end, delta);
        }
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
        <button type="button" className="wf-btn" title="Click to cycle zoom presets" onClick={() => {
          const presets = [1, 2, 4, 8, 12, 16, 24];
          const cur = zoom;
          let idx = presets.findIndex(p => Math.abs(p - cur) < 0.5);
          if (idx < 0) idx = 0;
          const next = presets[(idx + 1) % presets.length];
          setZoomAnchored(next);
        }}>{`${Math.round(zoom)}×`}</button>
        <button type="button" className="wf-btn" onClick={() => { if (selection && duration) { const len = Math.max(0.01, selection.end - selection.start); const nextZoom = Math.min(100, duration / len); setZoom(nextZoom); setViewStart(clampViewStart(selection.start - 0.05 * len)); } }} disabled={!selection || !(selection.end > selection.start)}>Sel</button>
        <button type="button" className="wf-btn" onClick={() => { setZoom((z) => Math.min(100, z * 1.5)); }}>+</button>
      </div>
      {/* Footer: shortcuts and legend */}
      <div className="waveform__footer">
        <div className="waveform__shortcuts">
          <span>Scroll to pan; Cmd/Ctrl+Scroll to zoom.</span>
          <span>Shortcuts: Z in, Shift+Z out, F fit, S selection.</span>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="wf-seg" role="group" aria-label="Quick zoom">
            <span className="panel__hint panel__hint--muted" style={{ marginRight: 4 }}>Zoom</span>
            <button type="button" className="wf-btn" onClick={() => { setZoomAnchored(1); }}>Fit</button>
            <button type="button" className={`wf-btn ${Math.abs(zoom - 1) < 0.5 ? 'is-active' : ''}`} onClick={() => setZoomAnchored(1)}>1×</button>
            <button type="button" className={`wf-btn ${Math.abs(zoom - 2) < 0.5 ? 'is-active' : ''}`} onClick={() => setZoomAnchored(2)}>2×</button>
            <button type="button" className={`wf-btn ${Math.abs(zoom - 4) < 0.5 ? 'is-active' : ''}`} onClick={() => setZoomAnchored(4)}>4×</button>
            <button type="button" className={`wf-btn ${Math.abs(zoom - 8) < 0.5 ? 'is-active' : ''}`} onClick={() => setZoomAnchored(8)}>8×</button>
            <button type="button" className={`wf-btn ${Math.abs(zoom - 12) < 0.5 ? 'is-active' : ''}`} onClick={() => setZoomAnchored(12)}>12×</button>
          </div>
          <div className="wf-seg" role="radiogroup" aria-label="Waveform style">
            <button type="button" className={`wf-btn ${styleMode === 'bars' ? 'is-active' : ''}`} onClick={() => setStyleMode('bars')} title="Bars">Bars</button>
            <button type="button" className={`wf-btn ${styleMode === 'line' ? 'is-active' : ''}`} onClick={() => setStyleMode('line')} title="Line">Line</button>
            <button type="button" className={`wf-btn ${styleMode === 'filled' ? 'is-active' : ''}`} onClick={() => setStyleMode('filled')} title="Filled">Filled</button>
          </div>
          <div className="wf-seg" role="group" aria-label="Overlays">
            <button type="button" className={`wf-btn ${showTicks ? 'is-active' : ''}`} onClick={() => setShowTicks(v => !v)} title="Word boundary ticks">Ticks</button>
            <button type="button" className={`wf-btn ${showWhiskers ? 'is-active' : ''}`} onClick={() => setShowWhiskers(v => !v)} title="Alignment adjustments">Adj</button>
            <button type="button" className={`wf-btn ${showBlocks ? 'is-active' : ''}`} onClick={() => setShowBlocks(v => !v)} title="Speech blocks">Blocks</button>
            <button type="button" className={`wf-btn ${showRepl ? 'is-active' : ''}`} onClick={() => setShowRepl(v => !v)} title="Replacement overlay">Repl</button>
          </div>
          <div className="wf-seg" role="group" aria-label="Delta">
            <button type="button" className={`wf-btn ${showDelta ? 'is-active' : ''}`} onClick={() => setShowDelta(v => !v)} title="Show Δ between replacement and original boundaries">Δ</button>
          </div>
          {showBlocks ? (
            <div className="wf-seg" role="radiogroup" aria-label="Speech block gap">
              <span className="panel__hint panel__hint--muted" style={{ marginRight: 4 }}>Gap</span>
              <button type="button" className={`wf-btn ${Math.abs(blockGap - 0.15) < 1e-6 ? 'is-active' : ''}`} onClick={() => setBlockGap(0.15)} title="0.15s">0.15s</button>
              <button type="button" className={`wf-btn ${Math.abs(blockGap - 0.25) < 1e-6 ? 'is-active' : ''}`} onClick={() => setBlockGap(0.25)} title="0.25s">0.25s</button>
              <button type="button" className={`wf-btn ${Math.abs(blockGap - 0.5) < 1e-6 ? 'is-active' : ''}`} onClick={() => setBlockGap(0.5)} title="0.5s">0.5s</button>
            </div>
          ) : null}
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
});
