import { useMemo, useState } from 'react';
import type { VoiceProfile } from '../types';
import { deleteXttsCustomVoice, updateXttsCustomVoice } from '../api/client';

interface XttsManageVoicesDialogProps {
  isOpen: boolean;
  voices: VoiceProfile[];
  accentOptions?: Array<{ id: string; label: string; flag?: string }>;
  onClose: () => void;
  onChanged: () => void; // refresh voices on save/delete
  onError?: (message: string) => void;
}

export function XttsManageVoicesDialog({ isOpen, voices, accentOptions = [], onClose, onChanged, onError }: XttsManageVoicesDialogProps) {
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return voices;
    return voices.filter((v) => v.label.toLowerCase().includes(term) || v.id.toLowerCase().includes(term));
  }, [voices, q]);

  if (!isOpen) return null;

  return (
    <div className="modal">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__dialog" role="dialog" aria-modal="true" aria-labelledby="xtts-manage-title">
        <header className="modal__header">
          <h2 id="xtts-manage-title">Manage XTTS Voices</h2>
          <div className="modal__subtitle" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </header>
        <div className="modal__body modal__body--scrollable">
          {filtered.length === 0 ? <p className="panel__empty">No custom voices found.</p> : null}
          {filtered.map((v) => (
            <VoiceRow
              key={v.id}
              voice={v}
              accents={accentOptions}
              busy={busyId === v.id}
              onSave={async (patch) => {
                try {
                  setBusyId(v.id);
                  await updateXttsCustomVoice(v.id, patch);
                  onChanged();
                } catch (err) {
                  onError?.(err instanceof Error ? err.message : 'Save failed');
                } finally {
                  setBusyId(null);
                }
              }}
              onDelete={async () => {
                if (!confirm(`Delete “${v.label}”?`)) return;
                try {
                  setBusyId(v.id);
                  await deleteXttsCustomVoice(v.id);
                  onChanged();
                } catch (err) {
                  onError?.(err instanceof Error ? err.message : 'Delete failed');
                } finally {
                  setBusyId(null);
                }
              }}
            />
          ))}
        </div>
        <footer className="modal__footer">
          <button className="modal__button" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}

function VoiceRow({ voice, accents, busy, onSave, onDelete }: { voice: VoiceProfile; accents: Array<{ id: string; label: string; flag?: string }>; busy: boolean; onSave: (patch: { language?: string; gender?: string; tags?: string[]; notes?: string; accent?: { id: string; label: string; flag: string } }) => void; onDelete: () => void; }) {
  const [language, setLanguage] = useState(voice.locale ?? '');
  const [gender, setGender] = useState(voice.gender ?? 'unknown');
  const [tags, setTags] = useState<string>((voice.tags || []).join(', '));
  const [notes, setNotes] = useState<string>(voice.notes ?? '');
  const [accentId, setAccentId] = useState<string>(voice.accent?.id ?? 'custom');
  const selectedAccent = accents.find((a) => a.id === accentId) || voice.accent || { id: 'custom', label: 'Custom Voice', flag: '🎙️' };
  const savePatch = () => {
    const patch: any = {};
    patch.language = language || undefined;
    patch.gender = gender || undefined;
    patch.tags = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    patch.notes = notes || undefined;
    const acc = accents.find((a) => a.id === accentId) || selectedAccent;
    patch.accent = { id: acc.id, label: acc.label, flag: acc.flag || '🎙️' };
    onSave(patch);
  };
  return (
    <div className="app__banner" style={{ gap: 12, alignItems: 'flex-start' }}>
      <div style={{ minWidth: 220 }}>
        <strong>{voice.label}</strong>
        <div style={{ opacity: 0.8, fontSize: 12 }}>{voice.id}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, flex: 1 }}>
        <label className="field">
          <span className="field__label">Language</span>
          <input type="text" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en-us" />
        </label>
        <label className="field">
          <span className="field__label">Gender</span>
          <select value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="unknown">unknown</option>
            <option value="female">female</option>
            <option value="male">male</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Accent</span>
          <select value={accentId} onChange={(e) => setAccentId(e.target.value)}>
            <option value="custom">Custom Voice</option>
            {accents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.flag ? `${a.flag} ` : ''}{a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ gridColumn: '1 / span 2' }}>
          <span className="field__label">Tags (comma separated)</span>
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="female, british, custom" />
        </label>
        <label className="field">
          <span className="field__label">Notes</span>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Source or details" />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="modal__button" onClick={savePatch} disabled={busy}>Save</button>
        <button className="modal__button modal__button--danger" onClick={onDelete} disabled={busy}>Delete</button>
      </div>
    </div>
  );
}

