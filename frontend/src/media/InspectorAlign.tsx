interface Props {
  busy: boolean;
  whisperxEnabled: boolean;
  selection: { start: number | null; end: number | null };
  marginSec: number;
  onMarginChange: (v: number) => void;
  onAlignFull: () => void;
  onAlignRegion: () => void;
}

export function InspectorAlign({ busy, whisperxEnabled, selection, marginSec, onMarginChange, onAlignFull, onAlignRegion }: Props) {
  return (
    <div className="panel media-card">
      <div className="panel__heading"><h3 className="panel__title">Alignment</h3></div>
      {!whisperxEnabled ? (
        <p className="panel__hint panel__hint--muted" title="Enable WhisperX on the server to get word-level timings and alignment.">WhisperX is disabled. Enable with WHISPERX_ENABLE=1.</p>
      ) : null}
      <div className="panel__actions panel__actions--wrap" style={{ gap: 8 }}>
        <button className="panel__button panel__button--primary" type="button" disabled={busy || !whisperxEnabled} onClick={onAlignFull}>
          {busy ? 'Aligning…' : 'Refine timings'}
        </button>
        <div className="panel__meta" style={{ marginLeft: 8 }}>or refine selection</div>
        <label className="field" aria-label="Margin s" style={{ width: 160 }}>
          <span className="field__label">Margin (s)</span>
          <input type="number" step="0.01" value={marginSec} onChange={(e) => onMarginChange(Number(e.target.value || '0.75'))} />
        </label>
        <button className="panel__button" type="button" disabled={busy || !whisperxEnabled || !(selection.start !== null && selection.end !== null)} onClick={onAlignRegion}>
          {busy ? 'Aligning…' : 'Refine region'}
        </button>
      </div>
    </div>
  );
}
