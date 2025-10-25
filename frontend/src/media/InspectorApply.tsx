interface Props {
  busy: boolean;
  previewUrl: string | null;
  finalUrl: string | null;
  onApply: () => void;
}

export function InspectorApply({ busy, previewUrl, finalUrl, onApply }: Props) {
  return (
    <div className="panel media-card">
      <div className="panel__heading"><h3 className="panel__title">Export</h3></div>
      {!previewUrl ? (
        <p className="panel__hint panel__hint--muted">Generate a preview first.</p>
      ) : (
        <div className="panel__actions" style={{ gap: 8 }}>
          <button className="panel__button panel__button--primary" type="button" disabled={busy} onClick={onApply}>
            {busy ? 'Working…' : 'Apply to media'}
          </button>
        </div>
      )}
      {finalUrl ? (
        <div style={{ marginTop: 8 }}>
          <p className="panel__meta">Final output</p>
          <audio controls src={finalUrl} style={{ width: '100%' }} />
          <p className="panel__hint panel__hint--muted">If this is a video container, open it from the Downloads after saving.</p>
        </div>
      ) : null}
    </div>
  );
}
