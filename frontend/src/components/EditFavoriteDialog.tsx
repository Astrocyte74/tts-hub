import { useEffect, useState } from 'react';

type FavoritePatch = {
  id: string;
  label: string;
  notes?: string;
  language?: string;
  speed?: number;
  trimSilence?: boolean;
  style?: string;
  seed?: number;
};

interface EditFavoriteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (patch: FavoritePatch) => Promise<void> | void;
  favorite: {
    id: string;
    label: string;
    engine: string;
    voiceId: string;
    language?: string;
    speed?: number;
    trimSilence?: boolean;
    style?: string;
    seed?: number;
    notes?: string;
  } | null;
  onEditVoice?: (voiceId: string) => void;
}

export function EditFavoriteDialog({ isOpen, onClose, onSave, favorite, onEditVoice }: EditFavoriteDialogProps) {
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [language, setLanguage] = useState('');
  const [speed, setSpeed] = useState(1);
  const [trim, setTrim] = useState(true);
  const [style, setStyle] = useState('');
  const [seed, setSeed] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !favorite) return;
    setLabel(favorite.label || '');
    setNotes(favorite.notes || '');
    setLanguage((favorite.language ?? 'en-us'));
    setSpeed(typeof favorite.speed === 'number' ? favorite.speed : 1);
    setTrim(favorite.trimSilence ?? true);
    setStyle(favorite.style ?? '');
    setSeed(typeof favorite.seed === 'number' ? String(favorite.seed) : '');
  }, [isOpen, favorite]);

  if (!isOpen || !favorite) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    setSaving(true);
    try {
      const patch: FavoritePatch = {
        id: favorite.id,
        label: label.trim(),
        notes: notes.trim() || undefined,
        language: language.trim() || undefined,
        speed: Number(speed),
        trimSilence: Boolean(trim),
      };
      if (favorite.engine === 'openvoice') patch.style = style.trim() || undefined;
      if (favorite.engine === 'chattts') {
        const parsed = seed.trim() ? Number(seed.trim()) : undefined;
        if (parsed !== undefined && Number.isFinite(parsed)) patch.seed = Math.floor(parsed);
      }
      await onSave(patch);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal">
      <div className="modal__backdrop" />
      <div className="modal__dialog" role="dialog" aria-modal="true" aria-labelledby="edit-favorite-title">
        <header className="modal__header">
          <h2 id="edit-favorite-title">Edit Favorite</h2>
          <p className="modal__subtitle">{favorite.engine} · {favorite.voiceId}</p>
        </header>
        <form className="modal__body" onSubmit={handleSubmit}>
          <label className="modal__field">
            <span>Label</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Favorite name" />
          </label>
          <label className="modal__field">
            <span>Notes</span>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add context (e.g., tone, use case)"></textarea>
          </label>
          <label className="modal__field">
            <span>Language</span>
            <input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en-us" />
          </label>
          <label className="modal__field">
            <span>Speed</span>
            <input type="number" step={0.05} min={0.5} max={2} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
          </label>
          <label className="modal__field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} />
            <span>Trim silence</span>
          </label>
          {favorite.engine === 'openvoice' ? (
            <label className="modal__field">
              <span>Style</span>
              <input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="default" />
            </label>
          ) : null}
          {favorite.engine === 'chattts' ? (
            <label className="modal__field">
              <span>Seed</span>
              <input type="number" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="(optional)" />
            </label>
          ) : null}
          {favorite.engine === 'xtts' && typeof onEditVoice === 'function' ? (
            <div className="modal__subtitle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>Edit voice metadata (gender/accent/tags) for this XTTS voice.</span>
              <button type="button" className="modal__button" onClick={() => onEditVoice(favorite.voiceId)}>Edit voice…</button>
            </div>
          ) : null}
          <footer className="modal__footer">
            <button type="button" className="modal__button modal__button--ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="modal__button modal__button--primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </footer>
        </form>
      </div>
    </div>
  );
}
