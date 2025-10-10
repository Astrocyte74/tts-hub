interface SynthesisActionsProps {
  canSynthesize: boolean;
  hasMultipleVoices: boolean;
  onSynthesize: () => void;
  onAudition: () => void;
  isSynthLoading: boolean;
  isAuditionLoading: boolean;
}

export function SynthesisActions({
  canSynthesize,
  hasMultipleVoices,
  onSynthesize,
  onAudition,
  isSynthLoading,
  isAuditionLoading,
}: SynthesisActionsProps) {
  return (
    <section className="panel panel--actions">
      <div className="panel__actions">
        <button className="panel__button panel__button--primary" type="button" onClick={onSynthesize} disabled={!canSynthesize || isSynthLoading}>
          {isSynthLoading ? 'Synthesising…' : 'Create clip'}
        </button>
        <button
          className="panel__button panel__button--ghost"
          type="button"
          onClick={onAudition}
          disabled={!hasMultipleVoices || isAuditionLoading}
        >
          {isAuditionLoading ? 'Building audition…' : 'Start audition'}
        </button>
      </div>
      <p className="panel__hint">
        Select one voice to create an individual clip or multiple voices to stitch an audition. Settings apply to both actions.
      </p>
    </section>
  );
}

