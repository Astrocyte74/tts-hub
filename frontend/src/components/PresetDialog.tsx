import { useEffect, useMemo, useState } from 'react';

interface PresetDialogProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  contextItems?: string[];
  existingLabel?: string | null;
  existingLabelHint?: string;
  existingLabelSuffix?: string;
  onCancel: () => void;
  onConfirm: (label: string, notes?: string, saveGlobalProfile?: boolean) => Promise<void> | void;
  isSaving: boolean;
  defaultLabel: string;
  defaultNotes?: string;
  labelFieldLabel?: string;
  labelPlaceholder?: string;
  notesFieldLabel?: string;
  notesPlaceholder?: string;
  confirmLabel?: string;
  emptyLabelError?: string;
  dialogId?: string;
  allowGlobalProfile?: boolean;
}

export function PresetDialog({
  isOpen,
  title,
  subtitle,
  contextItems = [],
  existingLabel,
  existingLabelHint,
  existingLabelSuffix = 'entry',
  onCancel,
  onConfirm,
  isSaving,
  defaultLabel,
  defaultNotes = '',
  labelFieldLabel = 'Preset name',
  labelPlaceholder = 'My favourite voice',
  notesFieldLabel = 'Notes (optional)',
  notesPlaceholder = 'Add context about this preset...',
  confirmLabel = 'Save preset',
  emptyLabelError = 'Please enter a name.',
  dialogId,
  allowGlobalProfile = false,
}: PresetDialogProps) {
  const [label, setLabel] = useState(defaultLabel);
  const [notes, setNotes] = useState(defaultNotes);
  const [error, setError] = useState<string | null>(null);
  const [saveGlobal, setSaveGlobal] = useState<boolean>(allowGlobalProfile);

  const headingId = useMemo(() => {
    if (dialogId) {
      return dialogId;
    }
    const normalised = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return normalised ? `${normalised}-dialog-title` : 'preset-dialog-title';
  }, [dialogId, title]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setLabel(defaultLabel);
    setNotes(defaultNotes);
    setError(null);
    setSaveGlobal(allowGlobalProfile);
  }, [isOpen, defaultLabel, defaultNotes, allowGlobalProfile]);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setError(emptyLabelError);
      return;
    }
    try {
      const trimmedNotes = notes.trim();
      await onConfirm(trimmedLabel, trimmedNotes ? trimmedNotes : undefined, saveGlobal);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save preset.';
      setError(message);
    }
  };

  return (
    <div className="modal">
      <div className="modal__backdrop" />
      <div className="modal__dialog" role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <header className="modal__header">
          <h2 id={headingId}>{title}</h2>
          {subtitle ? <p className="modal__subtitle">{subtitle}</p> : null}
          {contextItems.map((item) => (
            <p key={item} className="modal__subtitle">
              {item}
            </p>
          ))}
          {existingLabel ? (
            <p className="modal__notice">
              {existingLabelHint ?? 'Already saved as'} “{existingLabel}”. Saving again will create another {existingLabelSuffix}.
            </p>
          ) : null}
        </header>
        <form className="modal__body" onSubmit={handleSubmit}>
          <label className="modal__field">
            <span>{labelFieldLabel}</span>
            <input
              type="text"
              placeholder={labelPlaceholder}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              autoFocus
            />
          </label>
          <label className="modal__field">
            <span>{notesFieldLabel}</span>
            <textarea
              placeholder={notesPlaceholder}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
            />
          </label>
          {allowGlobalProfile ? (
            <label className="modal__field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" checked={saveGlobal} onChange={(e) => setSaveGlobal(e.target.checked)} />
              <span>Also save as global profile (available via API)</span>
            </label>
          ) : null}
          {error ? <p className="modal__error">{error}</p> : null}
          <footer className="modal__footer">
            <button type="button" className="modal__button modal__button--ghost" onClick={onCancel} disabled={isSaving}>
              Cancel
            </button>
            <button type="submit" className="modal__button modal__button--primary" disabled={isSaving}>
              {isSaving ? 'Saving…' : confirmLabel}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
