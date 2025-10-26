import { useEffect, useMemo, useRef, useState } from 'react';
import { mediaAlignFull, mediaAlignRegion, mediaApply, mediaEstimateUrl, mediaGetStats, mediaProbeUpload, mediaReplacePreview, mediaTranscribeFromUrl, mediaTranscribeUpload, resolveAudioUrl } from '../api/client';
import { IconWave } from '../icons';
import type { MediaTranscriptResult, MediaEstimateInfo, MediaProbeInfo } from '../types';
import './TranscriptPanel.css';
import { WaveformCanvas, type WaveformHandle } from './WaveformCanvas';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useSessionStorage } from '../hooks/useSessionStorage';

export function TranscriptPanel() {
  // no collapsible state (full-page)
  const testMediaUrl = (import.meta as any)?.env?.VITE_TEST_MEDIA_URL as string | undefined;
  const isDevEnv = Boolean((import.meta as any)?.env?.DEV);
  const [url, setUrl] = useState<string>(isDevEnv && testMediaUrl ? String(testMediaUrl) : '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [whisperxEnabled, setWhisperxEnabled] = useState<boolean>(false);
  const [regionStart, setRegionStart] = useState<string>('');
  const [regionEnd, setRegionEnd] = useState<string>('');
  const [regionMargin, setRegionMargin] = useState<string>('0.75');
  const [fadeMs, setFadeMs] = useState<string>('30');
  const [trimDb, setTrimDb] = useState<string>('40');
  const [trimPreMs, setTrimPreMs] = useState<string>('8');
  const [trimPostMs, setTrimPostMs] = useState<string>('8');
  const [duckDbVal, setDuckDbVal] = useLocalStorage<string>('kokoro:mediaDuckDb', '');
  const [ingestMode, setIngestMode] = useLocalStorage<'url' | 'file'>('kokoro:mediaIngestMode', 'url');
  const [ytInfo, setYtInfo] = useState<MediaEstimateInfo | null>(null);
  const [probeInfo, setProbeInfo] = useState<MediaProbeInfo | null>(null);
  const [replaceText, setReplaceText] = useState<string>('');
  const [replacePreviewUrl, setReplacePreviewUrl] = useState<string | null>(null);
  const [replaceDiffUrl, setReplaceDiffUrl] = useState<string | null>(null);
  const [replaceWords, setReplaceWords] = useState<{ text: string; start: number; end: number }[] | null>(null);
  const [replaceStatus, setReplaceStatus] = useState<string>('');
  const [finalUrl, setFinalUrl] = useState<string | null>(null);
  const [playbackTrack, setPlaybackTrack] = useState<'original' | 'diff' | 'preview'>('original');
  const [viewMode, setViewMode] = useState<'sentences' | 'words'>('words');
  const [selectUnit, setSelectUnit] = useLocalStorage<'word' | 'block'>('kokoro:mediaSelectUnit', 'word');
  const [wfBlockGap, setWfBlockGap] = useSessionStorage<number>('kokoro:wf:blockGap', 0.25);
  const [currentStep, setCurrentStep] = useLocalStorage<'1' | '2' | '3'>('kokoro:mediaStep', '1');
  const [voiceMode, setVoiceMode] = useState<'borrow' | 'xtts' | 'favorite'>('borrow');
  const [voiceList, setVoiceList] = useState<{ id: string; label: string }[]>([]);
  const [xttsAvailable, setXttsAvailable] = useState<boolean>(false);
  const [xttsMessage, setXttsMessage] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState<string>('');
  const [favList, setFavList] = useState<{ id: string; label: string; voiceId: string }[]>([]);
  const [favVoiceId, setFavVoiceId] = useState<string>('');
  const [loopPreview, setLoopPreview] = useLocalStorage<boolean>('kokoro:mediaLoopPreview', false);
  const [autoRefineOnPreview, setAutoRefineOnPreview] = useLocalStorage<boolean>('kokoro:mediaAutoRefine', true);
  const [lastRefinedSec, setLastRefinedSec] = useState<number | null>(null);
  const [hoveredWordIdx, setHoveredWordIdx] = useState<number | null>(null);
  const hoverScrollTimer = useRef<number | null>(null);

  useEffect(() => {
    if (hoveredWordIdx === null) return; // nothing to do
    const container = document.querySelector('.media-editor__words') as HTMLElement | null;
    const chip = document.querySelector(`[data-word-idx="${hoveredWordIdx}"]`) as HTMLElement | null;
    if (!container || !chip) return;
    try {
      const cRect = container.getBoundingClientRect();
      const r = chip.getBoundingClientRect();
      const margin = 32;
      const outOfView = r.top < cRect.top + margin || r.bottom > cRect.bottom - margin;
      if (!outOfView) return;
      if (hoverScrollTimer.current) window.clearTimeout(hoverScrollTimer.current);
      hoverScrollTimer.current = window.setTimeout(() => {
        try { chip.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }); } catch {}
      }, 60);
    } catch {}
  }, [hoveredWordIdx]);

  async function ensureVoices() {
    if (voiceList.length) return;
    try {
      // Lazy import to avoid circulars
      const { fetchVoices } = await import('../api/client');
      const cat = await fetchVoices('xtts');
      setVoiceList(cat.voices.map((v) => ({ id: v.id, label: v.label })));
      setXttsAvailable(Boolean((cat as any).available));
      setXttsMessage(typeof (cat as any).message === 'string' ? String((cat as any).message) : null);
    } catch {
      // ignore
    }
  }

  async function ensureFavorites() {
    if (favList.length) return;
    try {
      const { listProfiles } = await import('../api/client');
      const data = await listProfiles();
      const xtts = (data.profiles || []).filter((p) => p.engine === 'xtts');
      setFavList(xtts.map((p) => ({ id: p.id, label: p.label, voiceId: p.voiceId })));
    } catch {
      // ignore
    }
  }

  function joinWordsToPhrase(words: string[]): string {
    const needsNoSpace = (t: string) => /^[,.;:!?)]$/.test(t) || t.startsWith("'");
    const openNoSpaceAfter = /^[(\[\{]$/;
    let out = '';
    for (let i = 0; i < words.length; i += 1) {
      const t = String(words[i] ?? '').trim();
      if (!t) continue;
      const prev = i > 0 ? String(words[i - 1]) : '';
      const addSpace = i > 0 && !needsNoSpace(t) && !openNoSpaceAfter.test(prev);
      out += (addSpace ? ' ' : '') + t;
    }
    return out;
  }

  // (moved below after hooks are declared)
  const [transcript, setTranscript] = useState<MediaTranscriptResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [audioTime, setAudioTime] = useState<number>(0);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [dragTarget, setDragTarget] = useState<null | 'start' | 'end'>(null);
  const [avgRtf, setAvgRtf] = useState<{ full: number; region: number; transcribe: number }>({ full: 5, region: 5, transcribe: 10 });
  const progressTimer = useRef<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  // Word selection state (drag to select)
  const [isSelecting, setIsSelecting] = useState(false);
  const [selStartIdx, setSelStartIdx] = useState<number | null>(null);
  const [selEndIdx, setSelEndIdx] = useState<number | null>(null);
  const [isPreviewingSel, setIsPreviewingSel] = useState(false);
  const [cursorIdx, setCursorIdx] = useState<number>(0);
  const [findQuery, setFindQuery] = useState<string>('');
  const [findStartFrom, setFindStartFrom] = useState<number>(0);
  const [viewPanelOpen, setViewPanelOpen] = useLocalStorage<boolean>('kokoro:mediaViewPanel', false);
  const waveRef = useRef<WaveformHandle | null>(null);

  // Group words into speech blocks based on the waveform block gap (defaults to 0.25s)
  const wordBlocks = useMemo(() => {
    const words = transcript?.words || [];
    if (!words.length) return { blocks: [] as { startIdx: number; endIdx: number }[], blockIndex: [] as number[] };
    const gap = Number(wfBlockGap) > 0 ? Number(wfBlockGap) : 0.25;
    const out: { startIdx: number; endIdx: number }[] = [];
    const idxMap: number[] = new Array(words.length).fill(0);
    let sIdx = 0; let eIdx = 0; let blockNo = 0;
    for (let i = 1; i < words.length; i += 1) {
      const prev = words[i-1]!; const cur = words[i]!;
      const gapSec = Math.max(0, Number(cur.start||0) - Number(prev.end||0));
      if (gapSec > gap) {
        // close previous block
        eIdx = i-1; out.push({ startIdx: sIdx, endIdx: eIdx });
        for (let j = sIdx; j <= eIdx; j += 1) idxMap[j] = blockNo;
        blockNo += 1; sIdx = i;
      }
    }
    eIdx = words.length-1; out.push({ startIdx: sIdx, endIdx: eIdx });
    for (let j = sIdx; j <= eIdx; j += 1) idxMap[j] = blockNo;
    return { blocks: out, blockIndex: idxMap };
  }, [transcript?.words, wfBlockGap]);

  function clearSelection() {
    setSelStartIdx(null);
    setSelEndIdx(null);
  }

  function updateRegionFromIdxRange(aIdx: number, bIdx: number) {
    if (!transcript?.words?.length) return;
    const lo = Math.max(0, Math.min(aIdx, bIdx));
    const hi = Math.min(transcript.words.length - 1, Math.max(aIdx, bIdx));
    const ws = transcript.words.slice(lo, hi + 1);
    if (ws.length) {
      setRegionStart(ws[0].start.toFixed(2));
      setRegionEnd(ws[ws.length - 1].end.toFixed(2));
    }
  }

  // Auto-populate Replace text from current selection (after hooks are defined)
  useEffect(() => {
    if (!transcript?.words?.length) return;
    if (selStartIdx === null || selEndIdx === null) return;
    const lo = Math.max(0, Math.min(selStartIdx, selEndIdx));
    const hi = Math.min(transcript.words.length - 1, Math.max(selStartIdx, selEndIdx));
    const ws = transcript.words.slice(lo, hi + 1).map((w) => w.text);
    const phrase = joinWordsToPhrase(ws);
    setReplaceText(phrase);
  }, [selStartIdx, selEndIdx, transcript]);

  async function previewSelectionOnce() {
    const start = Number(regionStart);
    const end = Number(regionEnd);
    if (!audioRef.current || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    const audio = audioRef.current;
    const stopAt = end - 0.02;
    const playFrom = () => {
      try {
        audio.currentTime = start;
      } catch { /* ignore seek issues */ }
      const onTime = () => {
        if (audio.currentTime >= stopAt) {
          if (loopPreview) {
            try { audio.currentTime = start; } catch {}
          } else {
            audio.pause();
            audio.removeEventListener('timeupdate', onTime);
            setIsPreviewingSel(false);
          }
        }
      };
      audio.addEventListener('timeupdate', onTime);
      setIsPreviewingSel(true);
      void audio.play().catch(() => setIsPreviewingSel(false));
    };
    if (Number.isNaN(audio.duration) || audio.readyState < 1) {
      const onMeta = () => {
        audio.removeEventListener('loadedmetadata', onMeta);
        playFrom();
      };
      audio.addEventListener('loadedmetadata', onMeta);
      // force load by (re)assigning src if needed
      // no-op here because the tag already has src
    } else {
      playFrom();
    }
  }

  useEffect(() => {
    // Reload audio metadata when source changes
    if (audioRef.current) {
      try { audioRef.current.load(); } catch {}
    }
  }, [audioUrl]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onMeta = () => setAudioDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onTime = () => setAudioTime(el.currentTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('timeupdate', onTime);
    // initialize if already loaded
    if (el.readyState >= 1) {
      onMeta();
      onTime();
    }
    return () => {
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('timeupdate', onTime);
    };
  }, [audioRef.current]);

  // Drag handles for selection on custom timeline
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragTarget || !timelineRef.current || !audioDuration) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const t = (pct * audioDuration);
      if (dragTarget === 'start') {
        const newStart = Math.min(t, Number(regionEnd) || t);
        setRegionStart(newStart.toFixed(2));
      } else {
        const newEnd = Math.max(t, Number(regionStart) || 0);
        setRegionEnd(newEnd.toFixed(2));
      }
    }
    function onUp() { setDragTarget(null); snapRegionToWords(); }
    if (dragTarget) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp, { once: true });
    }
    return () => {
      window.removeEventListener('mousemove', onMove);
      // mouseup listener removed by once:true automatically
    };
  }, [dragTarget, audioDuration, regionStart, regionEnd]);

  function handleAudioPlay() {
    if (selStartIdx === null || selEndIdx === null) return; // normal play when no selection
    const audio = audioRef.current;
    if (!audio) return;
    const start = Number(regionStart);
    const end = Number(regionEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    const stopAt = end - 0.02;
    // Seek into start of selection if outside
    try {
      if (audio.currentTime < start - 0.05 || audio.currentTime > stopAt) {
        audio.currentTime = start;
      }
    } catch { /* ignore */ }
    const onTime = () => {
      if (audio.currentTime >= stopAt) {
        if (loopPreview) {
          try { audio.currentTime = start; } catch {}
        } else {
          audio.pause();
          audio.removeEventListener('timeupdate', onTime);
          setIsPreviewingSel(false);
        }
      }
    };
    audio.addEventListener('timeupdate', onTime);
    setIsPreviewingSel(true);
  }

  // Fetch stats for ETA when panel first opens
  async function refreshStats() {
    try {
      const s = await mediaGetStats();
      setAvgRtf({
        transcribe: typeof s.transcribe?.avg_rtf === 'number' && s.transcribe.avg_rtf > 0 ? s.transcribe.avg_rtf : 10,
        full: typeof s.align_full?.avg_rtf === 'number' && s.align_full.avg_rtf > 0 ? s.align_full.avg_rtf : 5,
        region: typeof s.align_region?.avg_rtf === 'number' && s.align_region.avg_rtf > 0 ? s.align_region.avg_rtf : 5,
      });
    } catch {
      // ignore
    }
  }

  // Fetch stats once when panel opens
  useEffect(() => {
    void refreshStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-analyze YouTube URL (debounced) for Step 1
  useEffect(() => {
    if (ingestMode !== 'url') return;
    const s = url.trim();
    if (!s) { setYtInfo(null); return; }
    const looksYoutube = /youtu(\.be|be\.com)/i.test(s);
    if (!looksYoutube) { setYtInfo(null); return; }
    const t = window.setTimeout(async () => {
      try {
        const info = await mediaEstimateUrl(s);
        setYtInfo(info);
      } catch (err) {
        // keep silent; show nothing
        setYtInfo(null);
      }
    }, 450);
    return () => window.clearTimeout(t);
  }, [ingestMode, url]);

  // Auto-probe selected file for Step 1
  useEffect(() => {
    if (ingestMode !== 'file') return;
    if (!file) { setProbeInfo(null); return; }
    let aborted = false;
    (async () => {
      try {
        const info = await mediaProbeUpload(file);
        if (!aborted) setProbeInfo(info);
      } catch {
        if (!aborted) setProbeInfo(null);
      }
    })();
    return () => { aborted = true; };
  }, [ingestMode, file]);

  async function handleTranscribe(kind: 'url' | 'file') {
    try {
      setBusy(true);
      setStatus(kind === 'url' ? 'Transcribing URL with faster‑whisper…' : 'Transcribing file with faster‑whisper…');
      setError(null);
      setTranscript(null);
      setAudioUrl(null);
      if (kind === 'url') {
        if (!url.trim()) {
          setError('Paste a YouTube URL first');
          return;
        }
        // ETA progress for YouTube using estimate and avgRtf
        try {
          if (avgRtf.transcribe > 0) {
            const est = await mediaEstimateUrl(url.trim());
            if (est?.duration && Number.isFinite(est.duration)) {
              const total = est.duration / avgRtf.transcribe;
              const startAt = Date.now();
              setProgress(0);
              progressTimer.current = window.setInterval(() => {
                const elapsed = (Date.now() - startAt) / 1000;
                setProgress(Math.max(0, Math.min(1, elapsed / total)));
              }, 1000);
            }
          }
        } catch { /* ignore estimate failures */ }
        const res = await mediaTranscribeFromUrl(url.trim());
        setTranscript(res.transcript);
        setAudioUrl(res.media?.audio_url ? resolveAudioUrl(res.media.audio_url) : null);
        setJobId(res.jobId);
        setWhisperxEnabled(Boolean(res.whisperx?.enabled));
        const elapsed = res.transcript?.stats?.elapsed ?? res.stats?.elapsed;
        const rtf = res.transcript?.stats?.rtf ?? res.stats?.rtf;
        if (typeof elapsed === 'number' && typeof rtf === 'number') {
          setStatus(`Transcribed in ${elapsed.toFixed(2)}s (RTF ${rtf.toFixed(2)}×)`);
        }
        setCurrentStep('2');
      } else {
        if (!file) {
          setError('Choose a media file to upload');
          return;
        }
        const res = await mediaTranscribeUpload(file);
        setTranscript(res.transcript);
        setAudioUrl(res.media?.audio_url ? resolveAudioUrl(res.media.audio_url) : null);
        setJobId(res.jobId);
        setWhisperxEnabled(Boolean(res.whisperx?.enabled));
        const elapsed = res.transcript?.stats?.elapsed ?? res.stats?.elapsed;
        const rtf = res.transcript?.stats?.rtf ?? res.stats?.rtf;
        if (typeof elapsed === 'number' && typeof rtf === 'number') {
          setStatus(`Transcribed in ${elapsed.toFixed(2)}s (RTF ${rtf.toFixed(2)}×)`);
        }
        setCurrentStep('2');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transcription failed');
    } finally {
      setBusy(false);
      setStatus('');
      if (progressTimer.current) { window.clearInterval(progressTimer.current); progressTimer.current = null; }
      setProgress(null);
    }
  }

  const [alignedFull, setAlignedFull] = useState<boolean>(false);
  const [alignDiff, setAlignDiff] = useState<{ compared?: number; changed?: number; mean_abs_ms?: number; median_abs_ms?: number; p95_abs_ms?: number; max_abs_ms?: number; top?: { idx?: number; text?: string; boundary?: string; delta_ms?: number; direction?: string }[] } | null>(null);
  const [alignScope, setAlignScope] = useState<'full' | 'region' | null>(null);
  const [alignWindow, setAlignWindow] = useState<{ start: number; end: number } | null>(null);
  const prevWordsRef = useRef<{ start: number; end: number; text?: string }[] | null>(null);
  const [lastBoundaryChanges, setLastBoundaryChanges] = useState<{ idx: number; boundary: 'start'|'end'; prev: number; next: number; deltaMs: number }[]>([]);
  const [lastBoundaryMap, setLastBoundaryMap] = useState<Record<number, { startPrev?: number; startNew?: number; endPrev?: number; endNew?: number }>>({});

  const describeAlignment = (diff: typeof alignDiff | null, scope: 'full' | 'region' | null, win: { start: number; end: number } | null) => {
    if (!diff || !diff.compared) return '';
    const n = diff.compared;
    const changed = diff.changed ?? 0;
    const mean = diff.mean_abs_ms ?? 0;
    const med = diff.median_abs_ms ?? 0;
    const p95 = diff.p95_abs_ms ?? 0;
    const mx = diff.max_abs_ms ?? 0;
    const where = scope === 'region' && win ? ` in the selected region (${win.start.toFixed(2)}–${win.end.toFixed(2)}s)` : '';
    return `Adjusted ${changed.toLocaleString()} of ${n.toLocaleString()} word boundaries${where}. Typical adjustment was about ${Math.round(mean)} ms (median ${Math.round(med)} ms; 95th percentile ${Math.round(p95)} ms; max ${Math.round(mx)} ms).`;
  };

  async function handleAlignFull() {
    if (!jobId) {
      setError('Transcribe first to create a job');
      return;
    }
    try {
      setBusy(true);
      setStatus('Aligning full transcript with WhisperX…');
      setError(null);
      // capture previous words for diff
      prevWordsRef.current = transcript?.words ? transcript.words.map(w => ({ start: w.start, end: w.end, text: w.text })) : null;
      // ETA progress: estimate using avgRtf.full and transcript duration
      if (transcript?.duration && avgRtf.full > 0) {
        const total = transcript.duration / avgRtf.full;
        const start = Date.now();
        setProgress(0);
        progressTimer.current = window.setInterval(() => {
          const elapsed = (Date.now() - start) / 1000;
          setProgress(Math.max(0, Math.min(1, elapsed / total)));
        }, 1000);
      }
      const res = await mediaAlignFull(jobId);
      setTranscript(res.transcript);
      const elapsed = res.stats?.elapsed;
      if (typeof elapsed === 'number') {
        const words = res.stats?.words ?? res.transcript?.words?.length ?? 0;
        setStatus(`Aligned full transcript in ${elapsed.toFixed(2)}s (words ${words})`);
      }
      setAlignedFull(true);
      try {
        const d = (res.stats as any)?.diff as any;
        if (d && typeof d === 'object') {
          setAlignDiff({
            compared: Number(d.compared) || undefined,
            changed: Number(d.changed) || undefined,
            mean_abs_ms: Number(d.mean_abs_ms) || undefined,
            median_abs_ms: Number(d.median_abs_ms) || undefined,
            p95_abs_ms: Number(d.p95_abs_ms) || undefined,
            max_abs_ms: Number(d.max_abs_ms) || undefined,
            top: Array.isArray(d.top) ? d.top.slice(0, 10) : undefined,
          });
          setAlignScope('full');
          setAlignWindow(null);
          // compute whiskers map
          if (prevWordsRef.current && Array.isArray(res.transcript?.words)) {
            const prev = prevWordsRef.current;
            const next = res.transcript.words as any[];
            const n = Math.min(prev.length, next.length);
            const changes: { idx: number; boundary: 'start'|'end'; prev: number; next: number; deltaMs: number }[] = [];
            const m: Record<number, { startPrev?: number; startNew?: number; endPrev?: number; endNew?: number }> = {};
            for (let i = 0; i < n; i += 1) {
              const p = prev[i]; const q = next[i];
              if (!p || !q) continue;
              if (Math.abs((q.start ?? 0) - (p.start ?? 0)) > 1e-3) {
                const deltaMs = ((q.start ?? 0) - (p.start ?? 0)) * 1000;
                changes.push({ idx: i, boundary: 'start', prev: p.start ?? 0, next: q.start ?? 0, deltaMs });
                m[i] = m[i] || {};
                m[i].startPrev = p.start ?? 0; m[i].startNew = q.start ?? 0;
              }
              if (Math.abs((q.end ?? 0) - (p.end ?? 0)) > 1e-3) {
                const deltaMs = ((q.end ?? 0) - (p.end ?? 0)) * 1000;
                changes.push({ idx: i, boundary: 'end', prev: p.end ?? 0, next: q.end ?? 0, deltaMs });
                m[i] = m[i] || {};
                m[i].endPrev = p.end ?? 0; m[i].endNew = q.end ?? 0;
              }
            }
            setLastBoundaryChanges(changes);
            setLastBoundaryMap(m);
          } else {
            setLastBoundaryChanges([]);
            setLastBoundaryMap({});
          }
        }
      } catch {}
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Alignment failed');
    } finally {
      setBusy(false);
      setStatus('');
      if (progressTimer.current) { window.clearInterval(progressTimer.current); progressTimer.current = null; }
      setProgress(null);
      void refreshStats();
    }
  }

  function snapSecondsToNearestWord(t: number, bound: 'start' | 'end'): number {
    if (!transcript?.words?.length) return t;
    let nearest = transcript.words[0]!.start;
    let best = Infinity;
    for (const w of transcript.words) {
      const v = bound === 'start' ? w.start : w.end;
      const d = Math.abs(v - t);
      if (d < best) {
        best = d;
        nearest = v;
      }
    }
    return Number(nearest.toFixed(2));
  }

  function snapRegionToWords() {
    const s = Number(regionStart), e = Number(regionEnd);
    if (!Number.isFinite(s) || !Number.isFinite(e)) return;
    const s2 = snapSecondsToNearestWord(s, 'start');
    const e2 = snapSecondsToNearestWord(e, 'end');
    setRegionStart(s2.toFixed(2));
    setRegionEnd(e2.toFixed(2));
  }

  // Helpers derived from selection
  const selectionValid = (() => {
    const s = Number(regionStart); const e = Number(regionEnd);
    return Number.isFinite(s) && Number.isFinite(e) && e > s;
  })();
  const canStep2 = Boolean((jobId && audioUrl) || transcript);
  const canStep3 = canStep2 && selectionValid;
  const showLegacyTimeline = false;

  // Guard against blank state if a persisted step is not yet unlocked
  useEffect(() => {
    // Normalise invalid values
    if (currentStep !== '1' && currentStep !== '2' && currentStep !== '3') {
      setCurrentStep('1');
      return;
    }
    if (currentStep === '2' && !canStep2) {
      setCurrentStep('1');
      return;
    }
    if (currentStep === '3') {
      if (!canStep2) {
        setCurrentStep('1');
        return;
      }
      if (!selectionValid) {
        setCurrentStep('2');
        return;
      }
    }
  }, [currentStep, canStep2, selectionValid, setCurrentStep]);

  function selectSegment(seg: { start: number; end: number }) {
    if (!transcript?.words?.length) return;
    let lo = 0, hi = transcript.words.length - 1;
    for (let i = 0; i < transcript.words.length; i += 1) { if (transcript.words[i].start >= seg.start) { lo = i; break; } }
    for (let j = transcript.words.length - 1; j >= 0; j -= 1) { if (transcript.words[j].end <= seg.end) { hi = j; break; } }
    setSelStartIdx(lo);
    setSelEndIdx(hi);
    setRegionStart(seg.start.toFixed(2));
    setRegionEnd(seg.end.toFixed(2));
    setCursorIdx(hi);
  }

  return (
    <div className="panel panel--compact" style={{ marginTop: 12 }}>
      <div className="media-editor">
        <div className="media-editor__left">
          {/* Step 1 — Import media */}
          {currentStep === '1' ? (
          <div className="step">
            <div className="step__title"><span className="step__badge">1</span> Import media</div>
            <div className="ingest-toolbar">
              <span className="ingest-toolbar__label">Source</span>
              <div className="segmented segmented--sm" role="radiogroup" aria-label="Ingest source">
                <label className={`segmented__option ${ingestMode === 'url' ? 'is-selected' : ''}`}>
                  <input type="radio" name="ingest" value="url" checked={ingestMode === 'url'} onChange={() => setIngestMode('url')} /> URL
                </label>
                <label className={`segmented__option ${ingestMode === 'file' ? 'is-selected' : ''}`}>
                  <input type="radio" name="ingest" value="file" checked={ingestMode === 'file'} onChange={() => setIngestMode('file')} /> File
                </label>
              </div>
            </div>
            <div className="form-grid">
              {ingestMode === 'url' ? (
                <>
                  <label className="field" style={{ minWidth: 280 }}>
                    <span className="field__label">YouTube URL</span>
                    <input type="url" placeholder="https://www.youtube.com/watch?v=..." value={url} onChange={(e) => setUrl(e.target.value)} />
                  </label>
                  <button className="panel__button action" type="button" disabled={busy || !url.trim()} onClick={() => handleTranscribe('url')}>Transcribe</button>
                </>
              ) : (
                <>
                  <label className="field">
                    <span className="field__label">Upload file</span>
                    <input ref={fileInputRef} type="file" accept="audio/*,video/*,.mp4,.mkv,.mov,.mp3,.wav,.flac,.ogg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </label>
                  <button className="panel__button action" type="button" disabled={busy || !file} onClick={() => handleTranscribe('file')}>Transcribe</button>
                </>
              )}
            </div>
            {error ? <p className="panel__hint panel__hint--warning">{error}</p> : null}
            {status ? (
              <p className="panel__hint panel__hint--notice" aria-live="polite">
                {busy ? '⏳ ' : ''}{status}
              </p>
            ) : null}
            {progress !== null ? (
              <div
                style={{ height: 6, background: 'rgba(148,163,184,0.2)', borderRadius: 6, overflow: 'hidden' }}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((progress ?? 0) * 100)}
                aria-label="Estimated progress"
              >
                <div style={{ width: `${Math.round(progress * 100)}%`, height: '100%', background: 'linear-gradient(90deg, #60a5fa, #22d3ee)' }} />
              </div>
            ) : null}
            <div className="panel__actions" style={{ justifyContent: 'flex-end' }}>
              <button className="panel__button" type="button" disabled={!((jobId && audioUrl) || transcript)} onClick={() => setCurrentStep('2')}>Next: Align</button>
            </div>
          </div>
          ) : null}
          {/* Step 2 — Whisper alignment (optional) (only after transcript exists) */}
          {transcript && currentStep === '2' ? (
          <div className="step">
            <div className="step__title"><span className="step__badge">2</span> Whisper alignment <span className="step__hint">(optional)</span> {alignedFull ? (<span className="status-pill status-pill--ok" style={{ marginLeft: 8 }}>Aligned</span>) : null}</div>
            <p className="panel__meta">Tip: Select a sentence or words below to define a region. You can refine just that region with WhisperX, or proceed to Replace and select there.</p>
            {whisperxEnabled ? (
              <div className="panel__actions panel__actions--wrap" style={{ gap: 8 }}>
                <button className="panel__button" type="button" disabled={busy || !jobId} onClick={handleAlignFull} title="Align transcript to audio for precise word timings using WhisperX">
                  {busy ? 'Aligning…' : 'Improve full timing (WhisperX)'}
                </button>
                <button
                  className="panel__button"
                  type="button"
                  disabled={busy || !jobId || !selectionValid}
                  title="Refine just the selected region with WhisperX"
                  onClick={async () => {
                    if (!jobId) { setError('Transcribe first'); return; }
                    const s = Number(regionStart), e = Number(regionEnd), m = Number(regionMargin || '0.75');
                    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) { setError('Select a valid region first'); return; }
                  try {
                      // capture previous words for diff
                      prevWordsRef.current = transcript?.words ? transcript.words.map(w => ({ start: w.start, end: w.end, text: w.text })) : null;
                      setBusy(true);
                      setStatus(`Aligning region ${s.toFixed(2)}–${e.toFixed(2)}s with WhisperX…`);
                      setError(null);
                      const dur = (e - s) + (Number.isFinite(m) ? Number(m) * 2 : 1.5);
                      const total = dur / (avgRtf.region > 0 ? avgRtf.region : 5);
                      const startAt = Date.now();
                      setProgress(0);
                      progressTimer.current = window.setInterval(() => {
                        const elapsed = (Date.now() - startAt) / 1000;
                        setProgress(Math.max(0, Math.min(1, elapsed / total)));
                      }, 1000);
                      const res = await mediaAlignRegion(jobId, s, e, Number.isFinite(m) ? m : undefined);
                      setTranscript(res.transcript);
                      const elapsed = res.stats?.elapsed;
                      const rtf = res.stats?.rtf;
                      const words = res.stats?.words ?? 0;
                      if (typeof elapsed === 'number' && typeof rtf === 'number') {
                        setStatus(`Aligned ${words} words in ${elapsed.toFixed(2)}s (RTF ${rtf.toFixed(2)}×)`);
                      }
                      try {
                        const d = (res.stats as any)?.diff as any;
                        if (d && typeof d === 'object') {
                          setAlignDiff({
                            compared: Number(d.compared) || undefined,
                            changed: Number(d.changed) || undefined,
                            mean_abs_ms: Number(d.mean_abs_ms) || undefined,
                            median_abs_ms: Number(d.median_abs_ms) || undefined,
                            p95_abs_ms: Number(d.p95_abs_ms) || undefined,
                            max_abs_ms: Number(d.max_abs_ms) || undefined,
                            top: Array.isArray(d.top) ? d.top.slice(0, 10) : undefined,
                          });
                          setAlignScope('region');
                          setAlignWindow({ start: s, end: e });
                          // compute whiskers for region
                          if (prevWordsRef.current && Array.isArray(res.transcript?.words)) {
                            const prev = prevWordsRef.current;
                            const next = res.transcript.words as any[];
                            const n = Math.min(prev.length, next.length);
                            const changes: { idx: number; boundary: 'start'|'end'; prev: number; next: number; deltaMs: number }[] = [];
                            const m: Record<number, { startPrev?: number; startNew?: number; endPrev?: number; endNew?: number }> = {};
                            for (let i = 0; i < n; i += 1) {
                              const p = prev[i]; const q = next[i];
                              if (!p || !q) continue;
                              if (Math.abs((q.start ?? 0) - (p.start ?? 0)) > 1e-3) {
                                const deltaMs = ((q.start ?? 0) - (p.start ?? 0)) * 1000;
                                changes.push({ idx: i, boundary: 'start', prev: p.start ?? 0, next: q.start ?? 0, deltaMs });
                                m[i] = m[i] || {}; m[i].startPrev = p.start ?? 0; m[i].startNew = q.start ?? 0;
                              }
                              if (Math.abs((q.end ?? 0) - (p.end ?? 0)) > 1e-3) {
                                const deltaMs = ((q.end ?? 0) - (p.end ?? 0)) * 1000;
                                changes.push({ idx: i, boundary: 'end', prev: p.end ?? 0, next: q.end ?? 0, deltaMs });
                                m[i] = m[i] || {}; m[i].endPrev = p.end ?? 0; m[i].endNew = q.end ?? 0;
                              }
                            }
                            setLastBoundaryChanges(changes);
                            setLastBoundaryMap(m);
                          } else {
                            setLastBoundaryChanges([]);
                            setLastBoundaryMap({});
                          }
                        }
                      } catch {}
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Region alignment failed');
                    } finally {
                      setBusy(false);
                      setStatus('');
                      if (progressTimer.current) { window.clearInterval(progressTimer.current); progressTimer.current = null; }
                      setProgress(null);
                      void refreshStats();
                    }
                  }}
                >
                  Refine selection (WhisperX)
                </button>
                {!jobId ? <p className="panel__hint panel__hint--muted">Transcribe first to create a job.</p> : null}
                <details className="subpanel" style={{ width: '100%' }}>
                  <summary className="panel__meta" style={{ cursor: 'pointer' }}>Precise adjust (advanced)</summary>
                  <div className="row" style={{ marginTop: 6 }}>
                    <label className="field field--sm" aria-label="Region start">
                      <span className="field__label">Start (s)</span>
                      <div className="row" style={{ gap: 6 }}>
                        <button className="panel__button" type="button" onClick={() => setRegionStart((v) => (Math.max(0, (Number(v) || 0) - 0.05)).toFixed(2))}>−0.05</button>
                        <input type="number" step="0.01" min={0} value={regionStart} onChange={(e) => setRegionStart(e.target.value)} className="grow" />
                        <button className="panel__button" type="button" onClick={() => setRegionStart((v) => ((Number(v) || 0) + 0.05).toFixed(2))}>+0.05</button>
                      </div>
                    </label>
                    <label className="field field--sm" aria-label="Region end">
                      <span className="field__label">End (s)</span>
                      <div className="row" style={{ gap: 6 }}>
                        <button className="panel__button" type="button" onClick={() => setRegionEnd((v) => (Math.max(0, (Number(v) || 0) - 0.05)).toFixed(2))}>−0.05</button>
                        <input type="number" step="0.01" min={0} value={regionEnd} onChange={(e) => setRegionEnd(e.target.value)} className="grow" />
                        <button className="panel__button" type="button" onClick={() => setRegionEnd((v) => ((Number(v) || 0) + 0.05).toFixed(2))}>+0.05</button>
                      </div>
                    </label>
                    <label className="field field--sm" aria-label="Margin">
                      <span className="field__label">Margin (s)</span>
                      <input type="number" step="0.01" value={regionMargin} onChange={(e) => setRegionMargin(e.target.value)} />
                    </label>
                  </div>
                  <button
                    className="panel__button"
                    type="button"
                    disabled={busy || !jobId}
                    onClick={async () => {
                    if (!jobId) { setError('Transcribe first'); return; }
                    const s = Number(regionStart), e = Number(regionEnd), m = Number(regionMargin || '0.75');
                    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) { setError('Enter start/end seconds (end > start)'); return; }
                    try {
                      setBusy(true);
                      setStatus(`Aligning region ${s.toFixed(2)}–${e.toFixed(2)}s with WhisperX…`);
                      setError(null);
                      // ETA progress for region: include margin
                      const dur = (e - s) + (Number.isFinite(m) ? Number(m) * 2 : 1.5);
                      const total = dur / (avgRtf.region > 0 ? avgRtf.region : 5);
                      const startAt = Date.now();
                      setProgress(0);
                      progressTimer.current = window.setInterval(() => {
                        const elapsed = (Date.now() - startAt) / 1000;
                        setProgress(Math.max(0, Math.min(1, elapsed / total)));
                      }, 1000);
                      const res = await mediaAlignRegion(jobId, s, e, Number.isFinite(m) ? m : undefined);
                      setTranscript(res.transcript);
                      const elapsed = res.stats?.elapsed;
                      const rtf = res.stats?.rtf;
                      const words = res.stats?.words ?? 0;
                      if (typeof elapsed === 'number' && typeof rtf === 'number') {
                        setStatus(`Aligned ${words} words in ${elapsed.toFixed(2)}s (RTF ${rtf.toFixed(2)}×)`);
                      }
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Region alignment failed');
                    } finally {
                      setBusy(false);
                      setStatus('');
                      if (progressTimer.current) { window.clearInterval(progressTimer.current); progressTimer.current = null; }
                      setProgress(null);
                      void refreshStats();
                    }
                  }}
                  >
                    {busy ? 'Aligning…' : 'Refine region'}
                  </button>
                </details>
              </div>
            ) : (
              <p className="panel__hint panel__hint--muted">WhisperX not enabled on this host. Install and enable to refine word timings.</p>
            )}
            {alignDiff && alignDiff.compared ? (
              <div className="subpanel">
                <p className="panel__meta">{describeAlignment(alignDiff, alignScope, alignWindow)}</p>
                {Array.isArray(alignDiff.top) && alignDiff.top.length ? (
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <span className="panel__meta">Examples:</span>
                    {alignDiff.top.slice(0, 5).map((t, i) => {
                      const val = Math.round(Math.abs(t.delta_ms || 0));
                      const dir = (t.delta_ms || 0) >= 0 ? 'later' : 'earlier';
                      const arrow = (t.delta_ms || 0) >= 0 ? '→' : '←';
                      const label = `${t.text ?? ''} ${val} ms ${dir} ${arrow}`;
                      let titleTxt = `Adjusted ${t.boundary} by ${val} ms ${dir}`;
                      try {
                        const idx = typeof t.idx === 'number' ? t.idx : -1;
                        const m = lastBoundaryMap[idx];
                        const b = String(t.boundary) === 'start' ? 'start' : 'end';
                        const p = b === 'start' ? m?.startPrev : m?.endPrev;
                        const n = b === 'start' ? m?.startNew : m?.endNew;
                        if (typeof p === 'number' && typeof n === 'number') {
                          titleTxt = `${b} ${p.toFixed(2)}s → ${n.toFixed(2)}s (${val} ms ${dir})`;
                        }
                      } catch {}
                      return (
                        <button
                          key={`ex-${i}-${t.idx}`}
                          className="chip-button chip-button--accent"
                          title={titleTxt}
                          type="button"
                          onMouseEnter={() => {
                            try {
                              const idx = typeof t.idx === 'number' ? t.idx : -1;
                              if (idx >= 0 && transcript?.words?.[idx]) {
                                const w = transcript.words[idx];
                                setSelStartIdx(idx);
                                setSelEndIdx(idx);
                                setRegionStart(w.start.toFixed(2));
                                setRegionEnd(w.end.toFixed(2));
                                setCursorIdx(idx);
                                const el = document.querySelector(`[data-word-idx="${idx}"]`);
                                if (el && 'scrollIntoView' in el) (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }
                            } catch {}
                          }}
                          onClick={() => {
                            // Jump to the word by index if available
                            try {
                              const idx = typeof t.idx === 'number' ? t.idx : -1;
                              if (idx >= 0 && transcript?.words?.[idx]) {
                                const w = transcript.words[idx];
                                setSelStartIdx(idx);
                                setSelEndIdx(idx);
                                setRegionStart(w.start.toFixed(2));
                                setRegionEnd(w.end.toFixed(2));
                                setCursorIdx(idx);
                                const el = document.querySelector(`[data-word-idx="${idx}"]`);
                                if (el && 'scrollIntoView' in el) (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }
                            } catch {}
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                    {alignDiff.top.length > 5 ? (
                      <span className="panel__meta">…</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="panel__actions" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <button className="panel__button" type="button" onClick={() => setCurrentStep('1')}>Back</button>
              <div className="segmented segmented--sm" role="radiogroup" aria-label="Selection unit">
                <label className={`segmented__option ${selectUnit === 'word' ? 'is-selected' : ''}`}>
                  <input type="radio" name="selunit" value="word" checked={selectUnit === 'word'} onChange={() => setSelectUnit('word')} /> Words
                </label>
                <label className={`segmented__option ${selectUnit === 'block' ? 'is-selected' : ''}`}>
                  <input type="radio" name="selunit" value="block" checked={selectUnit === 'block'} onChange={() => setSelectUnit('block')} /> Blocks
                </label>
              </div>
              {selectUnit === 'block' ? (
                <span className="panel__hint panel__hint--muted" style={{ marginLeft: 8 }}>
                  Block gap: {wfBlockGap.toFixed(2)}s
                  <button
                    type="button"
                    className="panel__button panel__button--sm"
                    style={{ marginLeft: 6 }}
                    title="Adjust block gap in waveform controls"
                    onClick={() => { try { waveRef.current?.showBlocksControls(); } catch {} }}
                  >
                    Adjust
                  </button>
                </span>
              ) : null}
              <button className="panel__button" type="button" disabled={!canStep2} onClick={() => setCurrentStep('3')}>Next: Replace</button>
            </div>
          </div>
          ) : null}
          {/* Replace preview (XTTS) */}
          {transcript && currentStep === '3' && (
            <div className="step">
              <div className="step__title"><span className="step__badge">3</span> Replace & preview</div>
              <div className="panel__actions panel__actions--wrap" style={{ gap: 8 }}>
                <div className="segmented" role="radiogroup" aria-label="Voice source">
                  <label className={`segmented__option ${voiceMode === 'borrow' ? 'is-selected' : ''}`} aria-label="Borrow from selection">
                    <input type="radio" name="voice-mode" value="borrow" checked={voiceMode === 'borrow'} onChange={() => setVoiceMode('borrow')} />
                    Borrow
                  </label>
                  <label className={`segmented__option ${voiceMode === 'xtts' ? 'is-selected' : ''}`} aria-label="Use XTTS voice">
                    <input type="radio" name="voice-mode" value="xtts" checked={voiceMode === 'xtts'} onChange={() => { setVoiceMode('xtts'); void ensureVoices(); }} />
                    XTTS
                  </label>
                  <label className={`segmented__option ${voiceMode === 'favorite' ? 'is-selected' : ''}`} aria-label="Use Favorite">
                    <input type="radio" name="voice-mode" value="favorite" checked={voiceMode === 'favorite'} onChange={() => { setVoiceMode('favorite'); void ensureFavorites(); }} />
                    Favorite
                  </label>
                </div>
                <label className="field" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title={whisperxEnabled ? 'Align region automatically before preview' : 'WhisperX not available'}>
                  <input type="checkbox" disabled={!whisperxEnabled} checked={!!autoRefineOnPreview && whisperxEnabled} onChange={(e) => setAutoRefineOnPreview(e.target.checked)} />
                  <span className="field__label">Auto-refine selection (WhisperX)</span>
                </label>
                <div className="voice-select-area">
                  {voiceMode === 'xtts' ? (
                    <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} aria-label="XTTS voice" style={{ minWidth: 240 }}>
                      <option value="">Choose a voice…</option>
                      {voiceList.map((v) => (
                        <option key={v.id} value={v.id}>{v.label}</option>
                      ))}
                    </select>
                  ) : voiceMode === 'favorite' ? (
                    <select value={favVoiceId} onChange={(e) => setFavVoiceId(e.target.value)} aria-label="Favorite voice" style={{ minWidth: 240 }}>
                      <option value="">Choose a favorite…</option>
                      {favList.map((f) => (
                        <option key={f.id} value={f.voiceId}>{f.label}</option>
                      ))}
                    </select>
                  ) : null}
                </div>
              </div>
              <details style={{ marginTop: 6 }}>
                <summary className="panel__meta" style={{ cursor: 'pointer' }}>Timing</summary>
                <div className="panel__actions panel__actions--wrap" style={{ gap: 8, marginTop: 6 }}>
                  <label className="field field--sm" aria-label="Fade ms">
                    <span className="field__label">Fade (ms)</span>
                    <input type="number" step="1" value={fadeMs} onChange={(e) => setFadeMs(e.target.value)} />
                  </label>
                  <label className="field field--sm" aria-label="Margin s">
                    <span className="field__label">Margin (s)</span>
                    <input type="number" step="0.01" value={regionMargin} onChange={(e) => setRegionMargin(e.target.value)} />
                  </label>
                  <label className="field field--md" aria-label="Duck dB">
                    <span className="field__label">Duck original (dB)</span>
                    <div className="row">
                      <input id="duck-db" type="number" step="1" placeholder="e.g. -18" value={duckDbVal} onChange={(e) => setDuckDbVal(e.target.value)} className="grow" />
                      <div className="btns-mini" role="group" aria-label="Duck presets">
                        <button className="panel__button" type="button" onClick={() => setDuckDbVal('')}>None</button>
                        <button className="panel__button" type="button" onClick={() => setDuckDbVal('-12')}>−12</button>
                        <button className="panel__button" type="button" onClick={() => setDuckDbVal('-18')}>−18</button>
                      </div>
                    </div>
                  </label>
                  <label className="field field--sm" aria-label="Trim dB">
                    <span className="field__label">Trim dB</span>
                    <input id="trim-db" type="number" step="1" value={trimDb} onChange={(e) => setTrimDb(e.target.value)} />
                  </label>
                  <label className="field field--sm" aria-label="Pre-pad ms">
                    <span className="field__label">Pre-pad (ms)</span>
                    <input id="trim-pre" type="number" step="1" value={trimPreMs} onChange={(e) => setTrimPreMs(e.target.value)} />
                  </label>
                  <label className="field field--sm" aria-label="Post-pad ms">
                    <span className="field__label">Post-pad (ms)</span>
                    <input id="trim-post" type="number" step="1" value={trimPostMs} onChange={(e) => setTrimPostMs(e.target.value)} />
                  </label>
                </div>
              </details>
              <label className="field" aria-label="Replace text" style={{ minWidth: 320, width: '100%' }}>
                <span className="field__label">Replace text</span>
                <textarea value={replaceText} onChange={(e) => setReplaceText(e.target.value)} placeholder="New line to speak…" rows={3} style={{ width: '100%', resize: 'vertical' }} />
              </label>
              <button
                className="panel__button panel__button--primary"
                type="button"
                disabled={busy || !jobId || !replaceText.trim() || !(Number(regionEnd) > Number(regionStart))}
                onClick={async () => {
                  if (!jobId) { setError('Transcribe first'); return; }
                  const s = Number(regionStart), e = Number(regionEnd);
                  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) { setError('Enter start/end seconds (end > start)'); return; }
                  try {
                    setBusy(true);
                    setReplaceStatus('Generating replace preview…');
                    setError(null);
                    setReplacePreviewUrl(null);
                    // Optional: auto-refine selection before preview
                    if (autoRefineOnPreview && whisperxEnabled) {
                      try {
                        prevWordsRef.current = transcript?.words ? transcript.words.map(w => ({ start: w.start, end: w.end, text: w.text })) : null;
                        const m = Number(regionMargin || '0.75');
                        const resAlign = await mediaAlignRegion(jobId, s, e, Number.isFinite(m) ? m : undefined);
                        setTranscript(resAlign.transcript);
                        setAlignScope('region');
                        setAlignWindow({ start: s, end: e });
                        setLastRefinedSec(Math.max(0, e - s));
                        // compute whiskers for auto-refine
                        if (prevWordsRef.current && Array.isArray(resAlign.transcript?.words)) {
                          const prev = prevWordsRef.current;
                          const next = resAlign.transcript.words as any[];
                          const n2 = Math.min(prev.length, next.length);
                          const changes2: { idx: number; boundary: 'start'|'end'; prev: number; next: number; deltaMs: number }[] = [];
                          const m2: Record<number, { startPrev?: number; startNew?: number; endPrev?: number; endNew?: number }> = {};
                          for (let i = 0; i < n2; i += 1) {
                            const p = prev[i]; const q = next[i];
                            if (!p || !q) continue;
                            if (Math.abs((q.start ?? 0) - (p.start ?? 0)) > 1e-3) {
                              const dms = ((q.start ?? 0) - (p.start ?? 0)) * 1000;
                              changes2.push({ idx: i, boundary: 'start', prev: p.start ?? 0, next: q.start ?? 0, deltaMs: dms });
                              m2[i] = m2[i] || {}; m2[i].startPrev = p.start ?? 0; m2[i].startNew = q.start ?? 0;
                            }
                            if (Math.abs((q.end ?? 0) - (p.end ?? 0)) > 1e-3) {
                              const dms = ((q.end ?? 0) - (p.end ?? 0)) * 1000;
                              changes2.push({ idx: i, boundary: 'end', prev: p.end ?? 0, next: q.end ?? 0, deltaMs: dms });
                              m2[i] = m2[i] || {}; m2[i].endPrev = p.end ?? 0; m2[i].endNew = q.end ?? 0;
                            }
                          }
                          setLastBoundaryChanges(changes2);
                          setLastBoundaryMap(m2);
                        }
                      } catch {
                        // ignore auto-refine failure
                      }
                    }
                    const chosen = voiceMode === 'xtts' ? (voiceId || undefined) : voiceMode === 'favorite' ? (favVoiceId || undefined) : undefined;
                    const duckDb = duckDbVal.trim() !== '' ? Number(duckDbVal) : undefined;
                    const res = await mediaReplacePreview({
                      jobId,
                      start: s,
                      end: e,
                      text: replaceText,
                      marginMs: Number(regionMargin) * 1000,
                      fadeMs: Number(fadeMs || '30'),
                      duckDb,
                      trimTopDb: Number(trimDb || '40'),
                      trimPrepadMs: Number(trimPreMs || '8'),
                      trimPostpadMs: Number(trimPostMs || '8'),
                      trimEnable: true,
                      voice: chosen,
                      alignReplace: true,
                    });
                    setReplacePreviewUrl(res.preview_url ? resolveAudioUrl(res.preview_url) : null);
                    setReplaceDiffUrl(res.diff_url ? resolveAudioUrl(res.diff_url) : null);
                    setReplaceWords(Array.isArray((res as any).replace_words) ? ((res as any).replace_words as any[]).map((w) => ({ text: String(w.text||''), start: Number(w.start||0), end: Number(w.end||0) })) : null);
                    setPlaybackTrack('preview');
                    const se = res.stats?.synth_elapsed;
                    if (typeof se === 'number') {
                      const refinedNote = (autoRefineOnPreview && whisperxEnabled && lastRefinedSec !== null) ? ` · refined ${lastRefinedSec.toFixed(1)}s region` : '';
                      setReplaceStatus(`Synthesized and patched preview in ${se.toFixed(2)}s${refinedNote}`);
                    }
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Replace preview failed');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Working…' : 'Preview replace'}
              </button>
              {replaceStatus ? <p className="panel__hint panel__hint--notice">{replaceStatus}</p> : null}
              {voiceMode === 'xtts' && voiceList.length === 0 ? (
                <p className="panel__hint panel__hint--muted">
                  {xttsAvailable
                    ? (xttsMessage || 'XTTS is available but no custom voices were found. Use “Borrow from selection” or add voices in the XTTS manager.')
                    : 'XTTS is not available on this server.'}
                </p>
              ) : null}
              <div className="panel__actions" style={{ justifyContent: 'space-between' }}>
                <button className="panel__button" type="button" onClick={() => setCurrentStep('2')}>Back</button>
              </div>
            </div>
          )}
        </div>
        <div className="media-editor__right">
          {/* Step 1 info card when no audio yet */}
          {currentStep === '1' && !audioUrl ? (
            <div className="media-info-card">
              {ingestMode === 'url' && ytInfo ? (
                <div className="media-info">
                  {ytInfo.thumbnail_url ? (
                    <img src={ytInfo.thumbnail_url} alt="Video thumbnail" className="media-info__thumb" />
                  ) : null}
                  <div className="media-info__meta">
                    <div className="media-info__row">
                      <a href={ytInfo.webpage_url || undefined} target="_blank" rel="noreferrer" className="media-info__title">{ytInfo.title || 'YouTube video'}</a>
                      <span className={`media-info__badge ${ytInfo.cached ? 'media-info__badge--cached' : 'media-info__badge--live'}`}>{ytInfo.cached ? 'Cached' : 'Live'}</span>
                    </div>
                    <div className="media-info__row">
                      <a href={ytInfo.channel_url || undefined} target="_blank" rel="noreferrer" className="media-info__line">{ytInfo.uploader || 'Unknown channel'}</a>
                      {ytInfo.upload_date ? (
                        <span className="media-info__line">· Published {(() => { const d = String(ytInfo.upload_date); return d.length===8 ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : d; })()}</span>
                      ) : null}
                    </div>
                    <div className="media-info__row">
                      <span className="media-info__line">Duration: {ytInfo.duration ? `${ytInfo.duration.toFixed(1)}s` : '—'}</span>
                      {typeof ytInfo.view_count === 'number' ? (
                        <span className="media-info__line">· {ytInfo.view_count.toLocaleString()} views</span>
                      ) : null}
                      {typeof ytInfo.like_count === 'number' ? (
                        <span className="media-info__line">· {ytInfo.like_count.toLocaleString()} likes</span>
                      ) : null}
                    </div>
                    {avgRtf.transcribe > 0 && ytInfo.duration ? (
                      <p className="media-info__hint">Est. transcribe time: {(ytInfo.duration / avgRtf.transcribe).toFixed(0)}s</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {ingestMode === 'file' && probeInfo ? (
                <div className="media-info">
                  <div className="media-info__icon" aria-hidden>🎞️</div>
                  <div className="media-info__meta">
                    <p className="media-info__title">Local file</p>
                    <p className="media-info__line">Format: {probeInfo.format} · Size: {(probeInfo.size_bytes / (1024*1024)).toFixed(1)} MB</p>
                    <p className="media-info__line">Duration: {probeInfo.duration.toFixed(1)}s {probeInfo.has_video ? '· video' : ''}</p>
                    {probeInfo.audio ? (
                      <p className="media-info__line">Audio: {probeInfo.audio.codec ?? '—'} · {probeInfo.audio.sample_rate ?? '—'} Hz · {probeInfo.audio.channels ?? '—'} ch</p>
                    ) : null}
                    {probeInfo.video ? (
                      <p className="media-info__line">Video: {probeInfo.video.codec ?? '—'} · {probeInfo.video.width ?? '—'}×{probeInfo.video.height ?? '—'} @ {probeInfo.video.fps?.toFixed?.(2) ?? '—'} fps</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {/* Compact source summary shown in later steps */}
          {audioUrl && (ytInfo || probeInfo) ? (
            <div className="media-info-mini" title={ytInfo?.title || undefined}>
              {ytInfo?.thumbnail_url ? (
                <img src={ytInfo.thumbnail_url} alt="Thumb" className="media-info-mini__thumb" />
              ) : null}
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="media-info-mini__title">
                  {ytInfo?.title || (probeInfo ? 'Local file' : 'Source')}
                </p>
                <p className="media-info-mini__line">
                  {ytInfo ? (
                    <>
                      {ytInfo.uploader || 'Unknown channel'} · {ytInfo.duration?.toFixed?.(1)}s {ytInfo.cached ? '· cached' : ''}
                    </>
                  ) : probeInfo ? (
                    <>
                      {probeInfo.format} · {probeInfo.duration.toFixed(1)}s {probeInfo.has_video ? '· video' : ''}
                    </>
                  ) : null}
                </p>
              </div>
            </div>
          ) : null}
          {audioUrl && (currentStep === '2' || currentStep === '3') ? (
            <div className="media-editor__player">
              {(() => {
                const playerSrc = playbackTrack === 'preview'
                  ? (replacePreviewUrl ?? audioUrl)
                  : playbackTrack === 'diff'
                  ? (replaceDiffUrl ?? audioUrl)
                  : audioUrl;
                return (
                  <>
                    <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      {currentStep === '2' ? (
                        <div className="segmented segmented--sm" aria-label="Playback (Step 2)">
                          <span className="segmented__option is-selected">Original</span>
                        </div>
                      ) : (
                        <div className="segmented segmented--sm" role="radiogroup" aria-label="Playback">
                          <label className={`segmented__option ${playbackTrack === 'original' ? 'is-selected' : ''}`}>
                            <input type="radio" name="pb" value="original" checked={playbackTrack === 'original'} onChange={() => setPlaybackTrack('original')} />
                            Original
                          </label>
                          <label className={`segmented__option ${playbackTrack === 'diff' ? 'is-selected' : ''}`}>
                            <input type="radio" name="pb" value="diff" checked={playbackTrack === 'diff'} onChange={() => setPlaybackTrack('diff')} disabled={!replaceDiffUrl} />
                            Diff
                          </label>
                          <label className={`segmented__option ${playbackTrack === 'preview' ? 'is-selected' : ''}`}>
                            <input type="radio" name="pb" value="preview" checked={playbackTrack === 'preview'} onChange={() => setPlaybackTrack('preview')} disabled={!replacePreviewUrl} />
                            Preview
                          </label>
                        </div>
                      )}
                      {currentStep === '3' ? (
                        <span className="panel__hint panel__hint--muted" style={{ marginLeft: 8 }}>
                          Original: source audio · Diff: only the changes · Preview: patched audio
                        </span>
                      ) : (
                        <span className="panel__hint panel__hint--muted" style={{ marginLeft: 8 }}>
                          Preview becomes available in Step 3
                        </span>
                      )}
                      <button className="panel__button" type="button" onClick={() => void previewSelectionOnce()} disabled={isPreviewingSel || !regionStart || !regionEnd}>
                        {isPreviewingSel ? 'Playing…' : 'Play selection'}
                      </button>
                      <label className="field" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title="Loop the current selection when previewing">
                        <input type="checkbox" checked={loopPreview} onChange={(e) => setLoopPreview(e.target.checked)} />
                        <span className="field__label">Loop selection</span>
                      </label>
                    </div>
                    <div className="row spaced" style={{ alignItems: 'center' }}>
                      <audio ref={audioRef} controls src={playerSrc ?? undefined} style={{ width: '100%' }} onPlay={handleAudioPlay} />
                    </div>
                    <WaveformCanvas
                      ref={waveRef}
                      audioUrl={playerSrc}
                      words={transcript?.words ?? null}
                      currentTime={audioTime}
                      selection={(Number(regionEnd) > Number(regionStart)) ? { start: Number(regionStart), end: Number(regionEnd) } : null}
                      persistKey={jobId || undefined}
                      onHoverWordIndex={(idx) => setHoveredWordIdx(idx)}
                      onChangeSelection={(s, e) => {
                        // Snap to nearest word indices and mirror selection in chips
                        const ws = transcript?.words || [];
                        if (ws.length) {
                          let lo = 0; let hi = ws.length - 1;
                          // first word whose end >= s
                          for (let i = 0; i < ws.length; i += 1) { if (ws[i].end >= s) { lo = i; break; } }
                          // last word whose start <= e
                          for (let j = ws.length - 1; j >= 0; j -= 1) { if (ws[j].start <= e) { hi = j; break; } }
                          setSelStartIdx(lo);
                          setSelEndIdx(hi);
                          setRegionStart(ws[lo].start.toFixed(2));
                          setRegionEnd(ws[hi].end.toFixed(2));
                        } else {
                          setRegionStart(s.toFixed(2));
                          setRegionEnd(e.toFixed(2));
                        }
                      }}
                      diffMarkers={lastBoundaryChanges}
                      replaceWords={replaceWords}
                      showLegend
                      defaultZoom={12}
                      height={120}
                    />
                  </>
                );
              })()}
              {/* Custom selection timeline overlay (legacy; hidden when waveform is used) */}
              {showLegacyTimeline ? (
              <div
                className="media-editor__timeline"
                ref={timelineRef}
                onClick={(e) => {
                  if (!audioDuration || !audioRef.current) return;
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  audioRef.current.currentTime = pct * audioDuration;
                }}
                aria-label="Timeline"
              >
                {/* selection highlight */}
                {(() => {
                  const s = Number(regionStart); const en = Number(regionEnd);
                  if (!audioDuration || !Number.isFinite(s) || !Number.isFinite(en) || en <= s) return null;
                  const left = `${(Math.max(0, s) / audioDuration) * 100}%`;
                  const width = `${(Math.max(0, Math.min(audioDuration, en) - Math.max(0, s)) / audioDuration) * 100}%`;
                  return (
                    <>
                      <div style={{ position: 'absolute', left, width, top: 0, bottom: 0, background: 'linear-gradient(90deg,#60a5fa,#22d3ee)', opacity: 0.6, borderRadius: 6 }} />
                      {/* drag handles */}
                      <div
                        role="slider"
                        aria-label="Selection start"
                        aria-orientation="horizontal"
                        aria-valuemin={0}
                        aria-valuemax={audioDuration || 0}
                        aria-valuenow={Number(regionStart) || 0}
                        title="Drag to adjust start"
                        onMouseDown={(e) => { e.preventDefault(); setDragTarget('start'); }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                            e.preventDefault();
                            const delta = e.key === 'ArrowLeft' ? -0.01 : 0.01;
                            const next = Math.max(0, Math.min(audioDuration || 0, (Number(regionStart) || 0) + delta));
                            setRegionStart(next.toFixed(2));
                          }
                        }}
                        style={{ position: 'absolute', left, top: -4, width: 10, height: 16, background: '#60a5fa', borderRadius: 3, cursor: 'ew-resize', transform: 'translateX(-50%)' }}
                      />
                      <div
                        role="slider"
                        aria-label="Selection end"
                        aria-orientation="horizontal"
                        aria-valuemin={0}
                        aria-valuemax={audioDuration || 0}
                        aria-valuenow={Number(regionEnd) || 0}
                        title="Drag to adjust end"
                        onMouseDown={(e) => { e.preventDefault(); setDragTarget('end'); }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                            e.preventDefault();
                            const delta = e.key === 'ArrowLeft' ? -0.01 : 0.01;
                            const next = Math.max(0, Math.min(audioDuration || 0, (Number(regionEnd) || 0) + delta));
                            setRegionEnd(next.toFixed(2));
                          }
                        }}
                        style={{ position: 'absolute', left: `calc(${left} + ${width})`, top: -4, width: 10, height: 16, background: '#22d3ee', borderRadius: 3, cursor: 'ew-resize', transform: 'translateX(-50%)' }}
                      />
                    </>
                  );
                })()}
                {/* playhead */}
                {audioDuration ? (
                  <div style={{ position: 'absolute', left: `${(audioTime / audioDuration) * 100}%`, top: -2, bottom: -2, width: 2, background: '#93c5fd' }} />
                ) : null}
              </div>
              ) : null}
              {/* Secondary play selection was redundant; kept single button next to player */}
            </div>
          ) : null}
          {replacePreviewUrl ? (
            <div>
              <p className="panel__meta">Preview with replacement applied</p>
              <audio controls src={replacePreviewUrl} style={{ width: '100%' }} />
              <div className="panel__actions" style={{ gap: 8, marginTop: 8 }}>
                <button
                  className="panel__button panel__button--primary"
                  type="button"
                  disabled={busy || !jobId}
                  onClick={async () => {
                    if (!jobId) { setError('Transcribe first'); return; }
                    try {
                      setBusy(true);
                      setStatus('Applying preview to final output…');
                      const res = await mediaApply(jobId);
                      setFinalUrl(res.final_url ? resolveAudioUrl(res.final_url) : null);
                      setStatus(`Applied to ${res.mode === 'video' ? 'video' : 'audio'} (${res.container})`);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Apply failed');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? 'Working…' : 'Apply to video'}
                </button>
              </div>
              {finalUrl ? (
                <div style={{ marginTop: 8 }}>
                  <p className="panel__meta">Final output</p>
                  {/* If video, let browser attempt playback; if not supported, it will offer a download */}
                  <audio controls src={finalUrl} style={{ width: '100%' }} />
                  <p className="panel__hint panel__hint--muted">If this is a video container, open it from the Downloads after saving.</p>
                </div>
              ) : null}
            </div>
          ) : null}
          {transcript && (currentStep === '2' || currentStep === '3') ? (
            <div className="media-editor__words">
              <p className="panel__meta">Language: {transcript.language || 'unknown'} · Duration: {transcript.duration?.toFixed?.(1) ?? transcript.duration}s</p>
              <details className="viewfind" open={Boolean(viewPanelOpen)} onToggle={(e) => setViewPanelOpen((e.currentTarget as HTMLDetailsElement).open)}>
                <summary className="viewfind__summary" style={{ cursor: 'pointer' }}>View & Find — {viewMode === 'words' ? 'Words' : 'Sentences'}</summary>
                <div className="row" style={{ alignItems: 'flex-end', gap: 8, marginTop: 6 }}>
                  <div className="segmented segmented--sm" role="radiogroup" aria-label="View">
                    <label className={`segmented__option ${viewMode === 'sentences' ? 'is-selected' : ''}`}>
                      <input type="radio" name="view" value="sentences" checked={viewMode === 'sentences'} onChange={() => setViewMode('sentences')} />
                      Sentences
                    </label>
                    <label className={`segmented__option ${viewMode === 'words' ? 'is-selected' : ''}`}>
                      <input type="radio" name="view" value="words" checked={viewMode === 'words'} onChange={() => setViewMode('words')} />
                      Words
                    </label>
                  </div>
                  <div style={{ flex: 1 }} />
                  <label className="field field--lg">
                    <span className="field__label">Find</span>
                    <input type="text" value={findQuery} onChange={(e) => { setFindQuery(e.target.value); if (!viewPanelOpen) setViewPanelOpen(true); }} placeholder="Type phrase to select…" />
                  </label>
                  <button
                    className="panel__button"
                    type="button"
                    onClick={() => {
                      if (!transcript?.words?.length || !findQuery.trim()) return;
                      const words = transcript.words.map((w) => w.text.toLowerCase());
                      const tokens = findQuery.toLowerCase().split(/\s+/).filter(Boolean);
                      if (!tokens.length) return;
                      let matchLo = -1, matchHi = -1;
                      for (let i = findStartFrom; i <= words.length - tokens.length; i += 1) {
                        let ok = true;
                        for (let j = 0; j < tokens.length; j += 1) { if (words[i + j] !== tokens[j]) { ok = false; break; } }
                        if (ok) { matchLo = i; matchHi = i + tokens.length - 1; break; }
                      }
                      if (matchLo === -1) { setFindStartFrom(0); return; }
                      setSelStartIdx(matchLo); setSelEndIdx(matchHi); updateRegionFromIdxRange(matchLo, matchHi); setCursorIdx(matchHi); setFindStartFrom(matchHi + 1);
                    }}
                  >
                    Find
                  </button>
                  <button className="panel__button" type="button" onClick={() => { setFindStartFrom(0); }}>
                    Reset
                  </button>
                </div>
              </details>
              <div className="selection-toolbar">
                <div className="selection-toolbar__meta panel__meta">Selection: {regionStart || '…'}s → {regionEnd || '…'}s {selectionValid ? `(${(Number(regionEnd) - Number(regionStart)).toFixed(2)}s)` : ''}</div>
                <div className="selection-toolbar__actions">
                  {(selectUnit === 'block' && !selectionValid && transcript?.words?.length) ? (
                    <button
                      className="panel__button panel__button--sm"
                      type="button"
                      onClick={() => {
                        const idx = Math.max(0, Math.min((selEndIdx ?? selStartIdx ?? cursorIdx ?? 0), (transcript?.words?.length || 1) - 1));
                        const b = wordBlocks.blocks[wordBlocks.blockIndex[idx]];
                        if (b && transcript?.words) {
                          const ws2 = transcript.words[b.startIdx]; const we2 = transcript.words[b.endIdx];
                          setSelStartIdx(b.startIdx);
                          setSelEndIdx(b.endIdx);
                          setRegionStart(ws2.start.toFixed(2));
                          setRegionEnd(we2.end.toFixed(2));
                          try { waveRef.current?.zoomToSelection(ws2.start, we2.end); } catch {}
                        }
                      }}
                    >
                      Select nearest block
                    </button>
                  ) : null}
                  <button className="panel__button panel__button--sm" type="button" onClick={() => { clearSelection(); }}>
                    Clear
                  </button>
                  <button className="panel__button panel__button--sm" type="button" disabled={!audioUrl || isPreviewingSel || !selectionValid} onClick={() => void previewSelectionOnce()}>
                    {isPreviewingSel ? 'Playing…' : 'Preview selection'}
                  </button>
                  {whisperxEnabled ? (
                  <button className="panel__button panel__button--sm panel__button--ghost" type="button" disabled={busy || !jobId || !selectionValid} onClick={async () => {
                    if (!jobId) { setError('Transcribe first'); return; }
                    const s = Number(regionStart), e = Number(regionEnd), m = Number(regionMargin || '0.75');
                    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) { setError('Enter start/end seconds (end > start)'); return; }
                    try {
                      setBusy(true);
                      setStatus(`Aligning region ${s.toFixed(2)}–${e.toFixed(2)}s with WhisperX…`);
                      setError(null);
                      const dur = (e - s) + (Number.isFinite(m) ? Number(m) * 2 : 1.5);
                      const total = dur / (avgRtf.region > 0 ? avgRtf.region : 5);
                      const startAt = Date.now();
                      setProgress(0);
                      progressTimer.current = window.setInterval(() => {
                        const elapsed = (Date.now() - startAt) / 1000;
                        setProgress(Math.max(0, Math.min(1, elapsed / total)));
                      }, 1000);
                      const res = await mediaAlignRegion(jobId, s, e, Number.isFinite(m) ? m : undefined);
                      setTranscript(res.transcript);
                      const elapsed = res.stats?.elapsed;
                      const rtf = res.stats?.rtf;
                      const words = res.stats?.words ?? 0;
                      if (typeof elapsed === 'number' && typeof rtf === 'number') {
                        setStatus(`Aligned ${words} words in ${elapsed.toFixed(2)}s (RTF ${rtf.toFixed(2)}×)`);
                      }
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Region alignment failed');
                    } finally {
                      setBusy(false);
                      setStatus('');
                      if (progressTimer.current) { window.clearInterval(progressTimer.current); progressTimer.current = null; }
                      setProgress(null);
                      void refreshStats();
                    }
                  }}>
                    {busy ? 'Aligning…' : 'Refine region'}
                  </button>
                ) : null}
                </div>
              </div>

              {viewMode === 'sentences' && transcript.segments?.length ? (
                <div role="list" aria-label="Transcript sentences" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {transcript.segments.map((seg, i) => (
                    <button
                      key={`seg-${i}`}
                      type="button"
                      className="chip-button"
                      title={`${seg.start.toFixed(2)}–${seg.end.toFixed(2)}s`}
                      onClick={() => selectSegment(seg)}
                      style={{ justifyContent: 'flex-start', whiteSpace: 'normal' }}
                    >
                      {seg.text}
                    </button>
                  ))}
                </div>
              ) : null}

              {viewMode === 'words' ? (
              <div
                role="list"
                aria-label="Transcript words (drag to select a region)"
                onMouseUp={() => setIsSelecting(false)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { clearSelection(); return; }
                  const maxIdx = transcript?.words?.length ? transcript.words.length - 1 : 0;
                  if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    const base = selEndIdx ?? selStartIdx ?? cursorIdx ?? 0;
                    const next = Math.min(maxIdx, base + 1);
                    if (e.shiftKey && selStartIdx !== null) {
                      setSelEndIdx(next); updateRegionFromIdxRange(selStartIdx, next);
                    } else {
                      setSelStartIdx(next); setSelEndIdx(next);
                      setRegionStart(transcript!.words[next].start.toFixed(2));
                      setRegionEnd(transcript!.words[next].end.toFixed(2));
                    }
                    setCursorIdx(next);
                  } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const base = selEndIdx ?? selStartIdx ?? cursorIdx ?? 0;
                    const prev = Math.max(0, base - 1);
                    if (e.shiftKey && selStartIdx !== null) {
                      setSelEndIdx(prev); updateRegionFromIdxRange(selStartIdx, prev);
                    } else {
                      setSelStartIdx(prev); setSelEndIdx(prev);
                      setRegionStart(transcript!.words[prev].start.toFixed(2));
                      setRegionEnd(transcript!.words[prev].end.toFixed(2));
                    }
                    setCursorIdx(prev);
                  } else if (e.key.toLowerCase() === 'a') {
                    const idx = selEndIdx ?? selStartIdx ?? cursorIdx ?? 0;
                    const seg = transcript?.segments?.find(s => s.start <= transcript!.words[idx].start && s.end >= transcript!.words[idx].end);
                    if (seg && transcript?.words?.length) {
                      let lo = 0, hi = transcript.words.length - 1;
                      for (let i = 0; i < transcript.words.length; i += 1) { if (transcript.words[i].start >= seg.start) { lo = i; break; } }
                      for (let j = transcript.words.length - 1; j >= 0; j -= 1) { if (transcript.words[j].end <= seg.end) { hi = j; break; } }
                      setSelStartIdx(lo); setSelEndIdx(hi); updateRegionFromIdxRange(lo, hi); setCursorIdx(hi);
                    }
                  }
                }}
              >
                {transcript.words?.length ? (
                  transcript.words.map((w, idx) => {
                    const a = selStartIdx ?? -1;
                    const b = selEndIdx ?? -1;
                    const lo = Math.min(a, b);
                    const hi = Math.max(a, b);
                    const selected = a !== null && b !== null && idx >= lo && idx <= hi;
                    const conf = typeof w.confidence === 'number' ? Math.max(0, Math.min(1, w.confidence)) : null;
                    const baseBgAlpha = 0.12 + (conf !== null ? (1 - conf) * 0.15 : 0.15);
                    const baseBorderAlpha = 0.22 + (conf !== null ? (1 - conf) * 0.1 : 0.1);
                    return (
                  <span
                    key={`w-${idx}`}
                    data-word-idx={idx}
                    role="listitem"
                    title={`t=${w.start.toFixed(2)}–${w.end.toFixed(2)}`}
                    className={`chip ${selectUnit === 'block' ? ((wordBlocks.blockIndex[idx] % 2 === 0) ? 'chip--blockA' : 'chip--blockB') : ''} ${hoveredWordIdx === idx ? 'chip--hover' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (selectUnit === 'block') {
                        const b = wordBlocks.blocks[wordBlocks.blockIndex[idx]];
                        if (b) {
                          setIsSelecting(false);
                          setSelStartIdx(b.startIdx);
                          setSelEndIdx(b.endIdx);
                          const ws2 = transcript!.words[b.startIdx]; const we2 = transcript!.words[b.endIdx];
                          setRegionStart(ws2.start.toFixed(2));
                          setRegionEnd(we2.end.toFixed(2));
                          return;
                        }
                      }
                      if (e.shiftKey && selStartIdx !== null) {
                        // Extend selection to this word
                        setSelEndIdx(idx);
                        updateRegionFromIdxRange(selStartIdx, idx);
                      } else {
                        setIsSelecting(true);
                        setSelStartIdx(idx);
                        setSelEndIdx(idx);
                        setRegionStart(w.start.toFixed(2));
                        setRegionEnd(w.end.toFixed(2));
                      }
                    }}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      if (selectUnit === 'block') {
                        const b = wordBlocks.blocks[wordBlocks.blockIndex[idx]];
                        if (b) {
                          const ws2 = transcript!.words[b.startIdx]; const we2 = transcript!.words[b.endIdx];
                          setSelStartIdx(b.startIdx);
                          setSelEndIdx(b.endIdx);
                          setRegionStart(ws2.start.toFixed(2));
                          setRegionEnd(we2.end.toFixed(2));
                          void previewSelectionOnce();
                          try { waveRef.current?.zoomToSelection(ws2.start, we2.end); } catch {}
                          return;
                        }
                      }
                      setSelStartIdx(idx);
                      setSelEndIdx(idx);
                      setRegionStart(w.start.toFixed(2));
                      setRegionEnd(w.end.toFixed(2));
                      void previewSelectionOnce();
                      try { waveRef.current?.zoomToSelection(w.start, w.end); } catch {}
                    }}
                        onMouseEnter={() => {
                          if (isSelecting) {
                            setSelEndIdx(idx);
                            const a2 = selStartIdx ?? idx;
                            updateRegionFromIdxRange(a2, idx);
                          }
                        }}
                        style={{
                          background: selected ? 'rgba(96,165,250,0.35)' : `rgba(148,163,184,${baseBgAlpha.toFixed(2)})`,
                          border: selected ? '1px solid rgba(96,165,250,0.8)' : `1px solid rgba(148,163,184,${baseBorderAlpha.toFixed(2)})`,
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
              ) : null}
            </div>
          ) : null}
        </div>
        </div>
    </div>
  );
}
