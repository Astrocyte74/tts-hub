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
}

export function FavoritesManagerDialog({ isOpen, favorites, onClose, onEdit, onDelete, onExport, onImport }: FavoritesManagerDialogProps) {
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
          {filtered.map((f) => (
            <div key={f.id} className="app__banner" style={{ gap: 8 }}>
              <div>
                <strong>{f.label}</strong>
                <div style={{ opacity: .8, fontSize: 12 }}>{f.engine} · {f.voiceId}</div>
                {f.notes ? <div style={{ marginTop: 6, fontSize: 13, opacity: .9 }}>{f.notes}</div> : null}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button className="modal__button" onClick={() => onEdit(f.id)}>Edit</button>
                <button className="modal__button modal__button--danger" onClick={() => onDelete(f.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
        <footer className="modal__footer">
          <button className="modal__button modal__button--ghost" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}

