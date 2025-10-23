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
  initialVoiceId?: string;
}

export function XttsManageVoicesDialog({ isOpen, voices, accentOptions = [], onClose, onChanged, onError, initialVoiceId }: XttsManageVoicesDialogProps) {
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  // Focus a specific voice by pre-filling search when opened from per-card Edit
  if (isOpen && initialVoiceId && q === '') {
    const v = voices.find((v) => v.id === initialVoiceId);
    if (v) {
      // show either id or label in search to bring it to the top
      setQ(v.id);
    }
  }

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
        <div className="modal__body modal__body--scrollable" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
    <div className="panel panel--compact" style={{ gap: 12 }}>
      <div>
        <strong>{voice.label}</strong>
        <div style={{ opacity: 0.8, fontSize: 12 }}>{voice.id}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label className="field">
          <span className="field__label">Language</span>
          <input type="text" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en-us" />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
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
        </div>
        <label className="field">
          <span className="field__label">Tags (comma separated)</span>
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="female, british, custom" />
        </label>
        <label className="field">
          <span className="field__label">Notes</span>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Source or details" />
        </label>
      </div>
      {/* Source (read-only) */}
      {voice.raw && (voice.raw as any)['meta'] && (voice.raw as any)['meta']['source'] ? (
        <div style={{ fontSize: 12, color: 'rgba(148,163,184,.9)' }}>
          <div><strong>Source</strong></div>
          {(() => {
            const src = (voice.raw as any)['meta']['source'] as Record<string, any>;
            if (src['type'] === 'youtube') {
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div>Type: YouTube</div>
                  {src['title'] ? <div>Title: {String(src['title'])}</div> : null}
                  {src['url'] ? (
                    <div>
                      URL: <a href={String(src['url'])} target="_blank" rel="noreferrer">{String(src['url'])}</a>
                    </div>
                  ) : null}
                  {(src['start'] !== undefined || src['end'] !== undefined) ? (
                    <div>Range: {src['start'] ?? 0}s – {src['end'] ?? ''}s</div>
                  ) : null}
                </div>
              );
            }
            if (src['type'] === 'upload') {
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div>Type: Upload</div>
                  {src['filename'] ? <div>File: {String(src['filename'])}</div> : null}
                  {(src['start'] !== undefined || src['end'] !== undefined) ? (
                    <div>Range: {src['start'] ?? 0}s – {src['end'] ?? ''}s</div>
                  ) : null}
                </div>
              );
            }
            return null;
          })()}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
        <button className="modal__button" onClick={savePatch} disabled={busy}>Save</button>
        <button className="modal__button modal__button--danger" onClick={onDelete} disabled={busy}>Delete</button>
      </div>
    </div>
  );
}
