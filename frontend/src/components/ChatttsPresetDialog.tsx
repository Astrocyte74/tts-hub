import { useEffect, useState } from 'react';

interface ChatttsPresetDialogProps {
  isOpen: boolean;
  clipLabel: string;
  speakerSnippet: string;
  seed?: number;
  existingPresetLabel?: string | null;
  onCancel: () => void;
  onConfirm: (label: string, notes?: string) => Promise<void> | void;
  isSaving: boolean;
  defaultLabel: string;
  defaultNotes?: string;
}

export function ChatttsPresetDialog({
  isOpen,
  clipLabel,
  speakerSnippet,
  seed,
  existingPresetLabel,
  onCancel,
  onConfirm,
  isSaving,
  defaultLabel,
  defaultNotes = '',
}: ChatttsPresetDialogProps) {
  const [label, setLabel] = useState(defaultLabel);
  const [notes, setNotes] = useState(defaultNotes);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setLabel(defaultLabel);
    setNotes(defaultNotes);
    setError(null);
  }, [isOpen, defaultLabel, defaultNotes]);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) {
      setError('Please enter a preset name.');
      return;
    }
    try {
      await onConfirm(trimmed, notes.trim() ? notes.trim() : undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save preset.';
      setError(message);
    }
  };

  return (
    <div className="modal">
      <div className="modal__backdrop" />
      <div className="modal__dialog" role="dialog" aria-modal="true" aria-labelledby="chattts-dialog-title">
        <header className="modal__header">
          <h2 id="chattts-dialog-title">Save ChatTTS Preset</h2>
          <p className="modal__subtitle">
            Clip: {clipLabel} · Seed: {seed ?? 'random'} · Speaker: {speakerSnippet}
          </p>
          {existingPresetLabel ? (
            <p className="modal__notice">Already saved as “{existingPresetLabel}”. Saving again will create another preset.</p>
          ) : null}
        </header>
        <form className="modal__body" onSubmit={handleSubmit}>
          <label className="modal__field">
            <span>Preset name</span>
            <input
              type="text"
              placeholder="My favourite voice"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              autoFocus
            />
          </label>
          <label className="modal__field">
            <span>Notes (optional)</span>
            <textarea
              placeholder="Add context about this speaker..."
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
            />
          </label>
          {error ? <p className="modal__error">{error}</p> : null}
          <footer className="modal__footer">
            <button type="button" className="modal__button modal__button--ghost" onClick={onCancel} disabled={isSaving}>
              Cancel
            </button>
            <button type="submit" className="modal__button modal__button--primary" disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save preset'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
