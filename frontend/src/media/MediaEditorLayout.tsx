import { useEffect, useMemo, useReducer, useState } from 'react';
import { editorReducer, initialEditorState, type EditorStep } from './EditorTypes';
import { TransportBar } from './TransportBar';
import { TranscriptView } from './TranscriptView';
import { InspectorImport } from './InspectorImport';
import { InspectorAlign } from './InspectorAlign';
import { InspectorReplace } from './InspectorReplace';
import { InspectorApply } from './InspectorApply';
import { useSessionStorage } from '../hooks/useSessionStorage';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { SynthesisResult } from '../types';
import {
  mediaTranscribeFromUrl,
  mediaTranscribeUpload,
  mediaEstimateUrl,
  mediaGetStats,
  mediaAlignFull,
  mediaAlignRegion,
  mediaReplacePreview,
  mediaApply,
  resolveAudioUrl,
  fetchVoices,
  listProfiles,
} from '../api/client';

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

export function MediaEditorLayout() {
  const [state, dispatch] = useReducer(editorReducer, undefined, initialEditorState);
  const [queue, setQueue] = useSessionStorage<QueueItem[]>('kokoro:queue.v1', []);
  const [, setResults] = useSessionStorage<SynthesisResult[]>('kokoro:history.v1', []);
  const [stats, setStats] = useState<{ transcribe: number; full: number; region: number }>({ transcribe: 10, full: 5, region: 5 });
  const [voiceOptions, setVoiceOptions] = useState<{ id: string; label: string }[]>([]);
  const [favoriteOptions, setFavoriteOptions] = useState<{ id: string; label: string; voiceId: string }[]>([]);
  const [progressTimer, setProgressTimer] = useState<number | null>(null);

  // Persisted preferences
  const [prefVoiceMode, setPrefVoiceMode] = useLocalStorage<'borrow' | 'xtts' | 'favorite'>('kokoro:media:voiceMode', 'borrow');
  const [prefVoiceId, setPrefVoiceId] = useLocalStorage<string>('kokoro:media:voiceId', '');
  const [prefFavVoiceId, setPrefFavVoiceId] = useLocalStorage<string>('kokoro:media:favVoiceId', '');
  const [prefTiming, setPrefTiming] = useLocalStorage<{ marginSec: number; fadeMs: number; trimEnable: boolean; trimTopDb: number; trimPrepadMs: number; trimPostpadMs: number }>('kokoro:media:timing', {
    marginSec: 0.75,
    fadeMs: 30,
    trimEnable: true,
    trimTopDb: 40,
    trimPrepadMs: 8,
    trimPostpadMs: 8,
  });

  useEffect(() => {
    (async () => {
      try { const s = await mediaGetStats(); setStats({ transcribe: s.transcribe?.avg_rtf || 10, full: s.align_full?.avg_rtf || 5, region: s.align_region?.avg_rtf || 5 }); } catch {}
      try { const cat = await fetchVoices('xtts'); setVoiceOptions(cat.voices.map((v) => ({ id: v.id, label: v.label }))); } catch {}
      try { const data = await listProfiles(); const xtts = (data.profiles || []).filter((p: any) => p.engine === 'xtts'); setFavoriteOptions(xtts.map((p: any) => ({ id: p.id, label: p.label, voiceId: p.voiceId }))); } catch {}
    })();
  }, []);

  // Load persisted prefs into editor state on first render
  useEffect(() => {
    dispatch({ type: 'SET_VOICE_MODE', voiceMode: prefVoiceMode });
    if (prefVoiceId) dispatch({ type: 'SET_VOICE_ID', voiceId: prefVoiceId });
    if (prefFavVoiceId) dispatch({ type: 'SET_FAVORITE_VOICE_ID', favoriteVoiceId: prefFavVoiceId });
    dispatch({ type: 'SET_TIMING', patch: prefTiming });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on changes
  useEffect(() => { setPrefVoiceMode(state.voiceMode); }, [state.voiceMode]);
  useEffect(() => { setPrefVoiceId(state.voiceId); }, [state.voiceId]);
  useEffect(() => { setPrefFavVoiceId(state.favoriteVoiceId); }, [state.favoriteVoiceId]);
  useEffect(() => { setPrefTiming(state.timing); }, [state.timing]);

  // Queue helpers
  function queueAdd(label: string): string {
    const id = `media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
    setQueue((prev) => [...prev, { id, label, engine: 'media', status: 'rendering', progress: 0, startedAt: new Date().toISOString() }]);
    return id;
  }
  function queueProgress(id: string, pct: number) {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, progress: Math.max(0, Math.min(100, Math.round(pct))) } : q)));
  }
  function queueDone(id: string) {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, status: 'done', progress: 100, finishedAt: new Date().toISOString() } : q)));
  }
  function queueErrorLatest(message: string) {
    setQueue((prev) => {
      const last = [...prev].reverse().find((q) => q.engine === 'media' && q.status === 'rendering');
      return last ? prev.map((q) => (q.id === last.id ? { ...q, status: 'error', error: message, finishedAt: new Date().toISOString() } : q)) : prev;
    });
  }

  // Actions
  async function doTranscribeUrl(url: string) {
    const qid = queueAdd('Media · Transcribe URL');
    dispatch({ type: 'SET_BUSY', busy: true, status: 'Transcribing URL with faster‑whisper…' });
    dispatch({ type: 'SET_ERROR', error: null });
    try {
      if (stats.transcribe > 0) {
        try {
          const est = await mediaEstimateUrl(url);
          if (est?.duration && Number.isFinite(est.duration)) {
            const total = est.duration / stats.transcribe;
            const startAt = Date.now();
            const t = setInterval(() => {
              const elapsed = (Date.now() - startAt) / 1000;
              queueProgress(qid, (elapsed / total) * 100);
            }, 1000);
            setTimeout(() => clearInterval(t), total * 1000 + 10000);
          }
        } catch {}
      }
      const res = await mediaTranscribeFromUrl(url);
      dispatch({ type: 'SET_TRANSCRIPT', transcript: res.transcript });
      dispatch({ type: 'SET_JOB', jobId: res.jobId, audioUrl: res.media?.audio_url ? resolveAudioUrl(res.media.audio_url) : null });
      dispatch({ type: 'SET_WHISPERX_ENABLED', value: Boolean(res.whisperx?.enabled) });
      dispatch({ type: 'SET_STEP', step: 'align' });
      queueDone(qid);
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', error: err?.message || 'Transcription failed' });
      queueErrorLatest(err?.message || 'Failed');
    } finally {
      dispatch({ type: 'SET_BUSY', busy: false, status: '' });
    }
  }

  async function doTranscribeFile(file: File) {
    const qid = queueAdd('Media · Transcribe File');
    dispatch({ type: 'SET_BUSY', busy: true, status: 'Transcribing file with faster‑whisper…' });
    dispatch({ type: 'SET_ERROR', error: null });
    try {
      const res = await mediaTranscribeUpload(file);
      dispatch({ type: 'SET_TRANSCRIPT', transcript: res.transcript });
      dispatch({ type: 'SET_JOB', jobId: res.jobId, audioUrl: res.media?.audio_url ? resolveAudioUrl(res.media.audio_url) : null });
      dispatch({ type: 'SET_WHISPERX_ENABLED', value: Boolean(res.whisperx?.enabled) });
      dispatch({ type: 'SET_STEP', step: 'align' });
      queueDone(qid);
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', error: err?.message || 'Transcription failed' });
      queueErrorLatest(err?.message || 'Failed');
    } finally {
      dispatch({ type: 'SET_BUSY', busy: false, status: '' });
    }
  }

  async function doAlignFull() {
    if (!state.jobId) return;
    const qid = queueAdd('Media · Align Full (WhisperX)');
    dispatch({ type: 'SET_BUSY', busy: true, status: 'Aligning full transcript with WhisperX…' });
    try {
      // ETA progress timer
      if (state.transcript?.duration && stats.full > 0) {
        const total = state.transcript.duration / stats.full;
        const startAt = Date.now();
        const handle = window.setInterval(() => {
          const elapsed = (Date.now() - startAt) / 1000;
          queueProgress(qid, (elapsed / total) * 100);
        }, 1000);
        setProgressTimer(handle as unknown as number);
      }
      const res = await mediaAlignFull(state.jobId);
      dispatch({ type: 'SET_TRANSCRIPT', transcript: res.transcript });
      queueDone(qid);
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', error: err?.message || 'Alignment failed' });
      queueErrorLatest(err?.message || 'Failed');
    } finally {
      dispatch({ type: 'SET_BUSY', busy: false, status: '' });
      if (progressTimer) { window.clearInterval(progressTimer); setProgressTimer(null); }
    }
  }

  async function doAlignRegion() {
    if (!state.jobId || state.selection.start == null || state.selection.end == null) return;
    const qid = queueAdd(`Media · Align Region (${state.selection.start.toFixed(2)}–${state.selection.end.toFixed(2)}s)`);
    dispatch({ type: 'SET_BUSY', busy: true, status: 'Aligning region with WhisperX…' });
    try {
      // ETA progress timer for region (include margin)
      const dur = (state.selection.end - state.selection.start) + (state.timing.marginSec * 2);
      if (dur > 0 && stats.region > 0) {
        const total = dur / stats.region;
        const startAt = Date.now();
        const handle = window.setInterval(() => {
          const elapsed = (Date.now() - startAt) / 1000;
          queueProgress(qid, (elapsed / total) * 100);
        }, 1000);
        setProgressTimer(handle as unknown as number);
      }
      const res = await mediaAlignRegion(state.jobId, state.selection.start, state.selection.end, state.timing.marginSec);
      dispatch({ type: 'SET_TRANSCRIPT', transcript: res.transcript });
      queueDone(qid);
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', error: err?.message || 'Region alignment failed' });
      queueErrorLatest(err?.message || 'Failed');
    } finally {
      dispatch({ type: 'SET_BUSY', busy: false, status: '' });
      if (progressTimer) { window.clearInterval(progressTimer); setProgressTimer(null); }
    }
  }

  async function doPreviewReplace() {
    if (!state.jobId || state.selection.start == null || state.selection.end == null) return;
    const qid = queueAdd('Media · Replace Preview');
    dispatch({ type: 'SET_BUSY', busy: true, status: 'Generating replace preview…' });
    dispatch({ type: 'SET_PREVIEW_URL', previewUrl: null });
    try {
      const chosen = state.voiceMode === 'xtts' ? (state.voiceId || undefined) : state.voiceMode === 'favorite' ? (state.favoriteVoiceId || undefined) : undefined;
      const res = await mediaReplacePreview({
        jobId: state.jobId,
        start: state.selection.start,
        end: state.selection.end,
        text: state.replaceText || '',
        marginMs: state.timing.marginSec * 1000,
        fadeMs: state.timing.fadeMs,
        trimEnable: state.timing.trimEnable,
        trimTopDb: state.timing.trimTopDb,
        trimPrepadMs: state.timing.trimPrepadMs,
        trimPostpadMs: state.timing.trimPostpadMs,
        voice: chosen,
      });
      dispatch({ type: 'SET_PREVIEW_URL', previewUrl: res.preview_url ? resolveAudioUrl(res.preview_url) : null });
      dispatch({ type: 'SET_STEP', step: 'apply' });
      queueDone(qid);
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', error: err?.message || 'Preview failed' });
      queueErrorLatest(err?.message || 'Failed');
    } finally {
      dispatch({ type: 'SET_BUSY', busy: false, status: '' });
    }
  }

  async function doApply() {
    if (!state.jobId) return;
    const qid = queueAdd('Media · Apply to Final');
    dispatch({ type: 'SET_BUSY', busy: true, status: 'Applying preview to final output…' });
    try {
      const res = await mediaApply(state.jobId);
      dispatch({ type: 'SET_FINAL_URL', finalUrl: res.final_url ? resolveAudioUrl(res.final_url) : null });
      queueDone(qid);
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', error: err?.message || 'Apply failed' });
      queueErrorLatest(err?.message || 'Failed');
    } finally {
      dispatch({ type: 'SET_BUSY', busy: false, status: '' });
    }
  }

  // Derived
  const canReplace = useMemo(() => state.selection.start != null && state.selection.end != null && (state.replaceText || '').trim().length > 0, [state.selection, state.replaceText]);

  // Next step suggestion
  const nextStep: EditorStep | null = useMemo(() => {
    if (state.step === 'align' && !state.busy && state.transcript) return 'replace';
    if (state.step === 'replace' && !state.busy && state.previewUrl) return 'apply';
    return null;
  }, [state.step, state.busy, state.transcript, state.previewUrl]);

  // Stepper UI
  const STEPS: { id: EditorStep; label: string }[] = [
    { id: 'import', label: 'Import' },
    { id: 'align', label: 'Align' },
    { id: 'replace', label: 'Replace' },
    { id: 'apply', label: 'Export' },
  ];

  return (
    <div className="media-editor" style={{ display: 'grid', gridTemplateRows: 'auto auto 1fr', gap: 12 }}>
      <div className="media-stepper" role="tablist" aria-label="Media editor steps">
        {STEPS.map((s, idx) => (
          <button
            key={s.id}
            className={`stepper__btn ${state.step === s.id ? 'is-active' : ''}`}
            role="tab"
            aria-selected={state.step === s.id}
            onClick={() => dispatch({ type: 'SET_STEP', step: s.id })}
          >
            <span className="stepper__index">{idx + 1}</span>
            <span className="stepper__label">{s.label}</span>
          </button>
        ))}
        <div className="stepper__status">
          {state.status ? <span className="panel__hint panel__hint--notice">{state.status}</span> : null}
          {state.error ? <span className="panel__hint panel__hint--warning">{state.error}</span> : null}
          {nextStep ? (
            <button type="button" className="panel__button stepper__next" onClick={() => dispatch({ type: 'SET_STEP', step: nextStep })}>
              Next: {STEPS.find((s) => s.id === nextStep)?.label}
            </button>
          ) : null}
          {(() => {
            const active = [...queue].filter((q) => q.engine === 'media' && q.status === 'rendering');
            const job = active.length ? active[active.length - 1] : null;
            if (!job) return null;
            const pct = Math.round(Math.max(0, Math.min(100, job.progress ?? 0)));
            return (
              <span className="job-pill" aria-live="polite">
                <span className="job-pill__label">{job.label}</span>
                <span className="job-pill__pct">{pct}%</span>
                <span className="job-pill__bar"><i style={{ width: `${pct}%` }} /></span>
              </span>
            );
          })()}
        </div>
      </div>

      {/* Transport */}
      <TransportBar
        audioUrl={state.audioUrl}
        selection={state.selection}
        onSetSelection={(start, end) => dispatch({ type: 'SET_SELECTION', start, end })}
      />

      {/* Main grid: Inspector + Work surface */}
      <div className="media-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) 1fr', gap: 16, alignItems: 'start' }}>
        <div>
          {state.step === 'import' ? (
            <InspectorImport busy={state.busy} status={state.status} error={state.error} onTranscribeUrl={doTranscribeUrl} onTranscribeFile={doTranscribeFile} />
          ) : null}
          {state.step === 'align' ? (
            <InspectorAlign busy={state.busy} whisperxEnabled={state.whisperxEnabled} selection={state.selection} marginSec={state.timing.marginSec} onMarginChange={(v) => dispatch({ type: 'SET_TIMING', patch: { marginSec: v } })} onAlignFull={doAlignFull} onAlignRegion={doAlignRegion} />
          ) : null}
          {state.step === 'replace' ? (
            <InspectorReplace
              busy={state.busy}
              voiceMode={state.voiceMode}
              voiceId={state.voiceId}
              favoriteVoiceId={state.favoriteVoiceId}
              onVoiceMode={(m) => dispatch({ type: 'SET_VOICE_MODE', voiceMode: m })}
              onVoiceId={(id) => dispatch({ type: 'SET_VOICE_ID', voiceId: id })}
              onFavoriteVoiceId={(id) => dispatch({ type: 'SET_FAVORITE_VOICE_ID', favoriteVoiceId: id })}
              replaceText={state.replaceText}
              onReplaceText={(t) => dispatch({ type: 'SET_REPLACE_TEXT', replaceText: t })}
              timing={state.timing}
              onTimingPatch={(patch) => dispatch({ type: 'SET_TIMING', patch })}
              voiceOptions={voiceOptions}
              favoriteOptions={favoriteOptions}
              onPreviewReplace={() => { if (canReplace) doPreviewReplace(); }}
            />
          ) : null}
          {state.step === 'apply' ? (
            <InspectorApply busy={state.busy} previewUrl={state.previewUrl} finalUrl={state.finalUrl} onApply={doApply} />
          ) : null}
        </div>
        <div>
          {state.transcript ? (
            <TranscriptView
              transcript={state.transcript}
              selection={state.selection}
              onSelectRange={(start, end) => dispatch({ type: 'SET_SELECTION', start: isNaN(start) ? null : start, end: isNaN(end) ? null : end })}
              onPreview={() => {/* hook for quick preview later */}}
            />
          ) : (
            <div className="media-empty">
              <p className="panel__meta">Paste a URL or upload a file to see the transcript here.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
