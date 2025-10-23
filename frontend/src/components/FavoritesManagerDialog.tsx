import { useMemo, useState } from 'react';

interface FavoritesManagerDialogProps {
  isOpen: boolean;
  favorites: Array<{
    id: string;
    label: string;
    engine: string;
    voiceId: string;
    notes?: string;
  }>;
  onClose: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onExport?: () => void;
  onImport?: (data: unknown) => void;
  voiceMetaMap?: Record<string, { locale?: string | null; gender?: string | null; accent?: { id: string; label: string; flag?: string } | null }>;
}

export function FavoritesManagerDialog({ isOpen, favorites, onClose, onEdit, onDelete, onExport, onImport, voiceMetaMap }: FavoritesManagerDialogProps) {
  const [q, setQ] = useState('');
  const [engine, setEngine] = useState<string>('all');

  const engines = useMemo(() => {
    const s = new Set(favorites.map((f) => f.engine));
    return ['all', ...Array.from(s)];
  }, [favorites]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return favorites.filter((f) => {
      if (engine !== 'all' && f.engine !== engine) return false;
      if (!term) return true;
      return f.label.toLowerCase().includes(term) || f.voiceId.toLowerCase().includes(term) || (f.notes ?? '').toLowerCase().includes(term);
    });
  }, [favorites, q, engine]);

  if (!isOpen) return null;

  return (
    <div className="modal">
      <div className="modal__backdrop" />
      <div className="modal__dialog" role="dialog" aria-modal="true" aria-labelledby="favorites-manager-title">
        <header className="modal__header">
          <h2 id="favorites-manager-title">Favorites</h2>
          <div className="modal__subtitle" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={engine} onChange={(e) => setEngine(e.target.value)}>
              {engines.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
            {onExport ? <button className="modal__button" onClick={onExport}>Export</button> : null}
            {onImport ? (
              <>
                <input id="fav-mgr-import" type="file" accept="application/json" style={{ display: 'none' }} onChange={async (e) => {
                  const file = e.target.files && e.target.files[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    const data = JSON.parse(text);
                    onImport(data);
                  } finally {
                    (e.target as HTMLInputElement).value = '';
                  }
                }} />
                <button className="modal__button" onClick={() => document.getElementById('fav-mgr-import')?.click()}>Import</button>
              </>
            ) : null}
          </div>
        </header>
        <div className="modal__body modal__body--scrollable">
          {filtered.length === 0 ? <p className="panel__empty">No favorites match.</p> : null}
          {filtered.map((f) => {
            const meta = voiceMetaMap ? voiceMetaMap[f.voiceId] : undefined;
            return (
            <div key={f.id} className="app__banner" style={{ gap: 8 }}>
              <div>
                <strong>{f.label}</strong>
                <div style={{ display:'flex', gap:6, alignItems:'center', opacity: .9, fontSize: 12 }}>
                  <span>{f.engine} · {f.voiceId}</span>
                  {meta?.accent ? (
                    <span className="fav-row__pill" title={meta.accent.label}>
                      <span aria-hidden>{meta.accent.flag}</span>
                      <span className="fav-row__pill-text">{meta.accent.label}</span>
                    </span>
                  ) : null}
                  {meta?.gender ? (
                    <span className="voice-card__badge" title={`Gender: ${meta.gender}`}>{meta.gender === 'female' ? '♀' : meta.gender === 'male' ? '♂' : '—'}</span>
                  ) : null}
                  {meta?.locale ? (
                    <span className="voice-card__badge" title={`Language: ${meta.locale}`}>{String(meta.locale).toUpperCase()}</span>
                  ) : null}
                </div>
                {f.notes ? <div style={{ marginTop: 6, fontSize: 13, opacity: .9 }}>{f.notes}</div> : null}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button className="modal__button" onClick={() => onEdit(f.id)}>Edit</button>
                <button className="modal__button modal__button--danger" onClick={() => { if (confirm(`Delete “${f.label}”?`)) onDelete(f.id); }}>Delete</button>
              </div>
            </div>
          );})}
        </div>
        <footer className="modal__footer">
          <button className="modal__button modal__button--ghost" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
