import { useMemo, useState } from 'react';

interface FavoritesManagerDialogProps {
  isOpen: boolean;
  favorites: Array<{
    id: string;
    label: string;
    engine: string;
    voiceId: string;
    notes?: string;
    tags?: string[];
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
  const [tag, setTag] = useState<string>('all');

  const engines = useMemo(() => {
    const s = new Set(favorites.map((f) => f.engine));
    return ['all', ...Array.from(s)];
  }, [favorites]);

  const tags = useMemo(() => {
    const s = new Set<string>();
    favorites.forEach((f) => (f.tags || []).forEach((t) => t && s.add(t)));
    return ['all', ...Array.from(s).sort((a, b) => a.localeCompare(b))];
  }, [favorites]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return favorites.filter((f) => {
      if (engine !== 'all' && f.engine !== engine) return false;
      if (tag !== 'all') {
        const hasTag = (f.tags || []).some((t) => t === tag);
        if (!hasTag) return false;
      }
    
      if (!term) return true;
      const hay = [f.label, f.voiceId, f.notes || '', ...(f.tags || [])].join(' ').toLowerCase();
      return hay.includes(term);
    });
  }, [favorites, q, engine, tag]);

  if (!isOpen) return null;

  return (
    <div className="modal">
      <div className="modal__backdrop" />
      <div className="modal__dialog" role="dialog" aria-modal="true" aria-labelledby="favorites-manager-title">
        <header className="modal__header">
          <h2 id="favorites-manager-title">Favorites</h2>
          <div className="modal__subtitle" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={engine} onChange={(e) => setEngine(e.target.value)}>
              {engines.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
            <select value={tag} onChange={(e) => setTag(e.target.value)}>
              {tags.map((t) => (
                <option key={t} value={t}>{t}</option>
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
                {f.tags && f.tags.length ? (
                  <div style={{ marginTop: 6, fontSize: 12, opacity: .9 }}>
                    Tags: {f.tags.join(', ')}
                  </div>
                ) : null}
                {f.notes ? <div className="favorites-manager__notes" style={{ marginTop: 6, fontSize: 13, opacity: .9 }}>{f.notes}</div> : null}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button className="modal__button" onClick={() => onEdit(f.id)}>Edit</button>
                <button className="modal__button modal__button--danger" onClick={() => { if (confirm(`Delete “${f.label}”?`)) onDelete(f.id); }}>Delete</button>
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
