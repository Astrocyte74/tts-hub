import type { VoiceMode } from './EditorTypes';

interface Props {
  busy: boolean;
  voiceMode: VoiceMode;
  voiceId: string;
  favoriteVoiceId: string;
  onVoiceMode: (m: VoiceMode) => void;
  onVoiceId: (id: string) => void;
  onFavoriteVoiceId: (id: string) => void;
  replaceText: string;
  onReplaceText: (t: string) => void;
  timing: { fadeMs: number; marginSec: number; trimEnable: boolean; trimTopDb: number; trimPrepadMs: number; trimPostpadMs: number };
  onTimingPatch: (patch: Partial<Props['timing']>) => void;
  voiceOptions: { id: string; label: string }[];
  favoriteOptions: { id: string; label: string; voiceId: string }[];
  onPreviewReplace: () => void;
}

export function InspectorReplace({ busy, voiceMode, voiceId, favoriteVoiceId, onVoiceMode, onVoiceId, onFavoriteVoiceId, replaceText, onReplaceText, timing, onTimingPatch, voiceOptions, favoriteOptions, onPreviewReplace }: Props) {
  return (
    <div className="card">
      <div className="panel__heading"><h3 className="panel__title">Select & Replace</h3></div>
      <fieldset className="panel__actions" style={{ gap: 8, border: '1px dashed rgba(148,163,184,0.35)', padding: 8, borderRadius: 8 }}>
        <legend className="panel__meta">Voice</legend>
        <label className="field" aria-label="Borrow voice">
          <input type="radio" name="voice-mode" checked={voiceMode === 'borrow'} onChange={() => onVoiceMode('borrow')} /> Borrow from selection
        </label>
        <label className="field" aria-label="Select XTTS voice">
          <input type="radio" name="voice-mode" checked={voiceMode === 'xtts'} onChange={() => onVoiceMode('xtts')} /> Use XTTS voice:
        </label>
        {voiceMode === 'xtts' ? (
          <select value={voiceId} onChange={(e) => onVoiceId(e.target.value)} aria-label="XTTS voice" style={{ minWidth: 240 }}>
            <option value="">Choose a voice…</option>
            {voiceOptions.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        ) : null}
        <label className="field" aria-label="Select Favorite">
          <input type="radio" name="voice-mode" checked={voiceMode === 'favorite'} onChange={() => onVoiceMode('favorite')} /> Use Favorite:
        </label>
        {voiceMode === 'favorite' ? (
          <select value={favoriteVoiceId} onChange={(e) => onFavoriteVoiceId(e.target.value)} aria-label="Favorite voice" style={{ minWidth: 240 }}>
            <option value="">Choose a favorite…</option>
            {favoriteOptions.map((f) => (
              <option key={f.id} value={f.voiceId}>{f.label}</option>
            ))}
          </select>
        ) : null}
      </fieldset>

      <details style={{ marginTop: 6 }}>
        <summary className="panel__meta" style={{ cursor: 'pointer' }}>Timing</summary>
        <div className="panel__actions panel__actions--wrap" style={{ gap: 8, marginTop: 6 }}>
          <label className="field" aria-label="Fade ms" style={{ width: 160 }}>
            <span className="field__label">Fade (ms)</span>
            <input type="number" step="1" value={timing.fadeMs} onChange={(e) => onTimingPatch({ fadeMs: Number(e.target.value || '30') })} />
          </label>
          <label className="field" aria-label="Margin s" style={{ width: 160 }}>
            <span className="field__label">Margin (s)</span>
            <input type="number" step="0.01" value={timing.marginSec} onChange={(e) => onTimingPatch({ marginSec: Number(e.target.value || '0.75') })} />
          </label>
          <label className="field" aria-label="Trim dB" style={{ width: 160 }}>
            <span className="field__label">Trim dB</span>
            <input type="number" step="1" value={timing.trimTopDb} onChange={(e) => onTimingPatch({ trimTopDb: Number(e.target.value || '40') })} />
          </label>
          <label className="field" aria-label="Pre-pad ms" style={{ width: 160 }}>
            <span className="field__label">Pre-pad (ms)</span>
            <input type="number" step="1" value={timing.trimPrepadMs} onChange={(e) => onTimingPatch({ trimPrepadMs: Number(e.target.value || '8') })} />
          </label>
          <label className="field" aria-label="Post-pad ms" style={{ width: 160 }}>
            <span className="field__label">Post-pad (ms)</span>
            <input type="number" step="1" value={timing.trimPostpadMs} onChange={(e) => onTimingPatch({ trimPostpadMs: Number(e.target.value || '8') })} />
          </label>
        </div>
      </details>

      <label className="field" aria-label="Replace text" style={{ minWidth: 320, width: '100%', marginTop: 8 }}>
        <span className="field__label">Replace text</span>
        <textarea value={replaceText} onChange={(e) => onReplaceText(e.target.value)} placeholder="New line to speak…" rows={3} style={{ width: '100%', resize: 'vertical' }} />
      </label>
      <div className="panel__actions" style={{ gap: 8, marginTop: 6 }}>
        <button className="panel__button panel__button--primary" type="button" disabled={busy || !replaceText.trim()} onClick={onPreviewReplace}>
          {busy ? 'Working…' : 'Preview replace'}
        </button>
      </div>
    </div>
  );
}

