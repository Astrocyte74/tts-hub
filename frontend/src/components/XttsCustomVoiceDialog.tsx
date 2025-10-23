import { useRef, useState } from 'react';
import { createXttsCustomVoiceFromYouTube, createXttsCustomVoiceUpload, type CreateXttsCustomVoiceResponse } from '../api/client';

interface XttsCustomVoiceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (voice: { id: string; label: string }) => void;
  onError?: (message: string) => void;
}

export function XttsCustomVoiceDialog({ isOpen, onClose, onCreated, onError }: XttsCustomVoiceDialogProps) {
  const [tab, setTab] = useState<'upload' | 'youtube'>('upload');
  const [label, setLabel] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const reset = () => {
    setLabel('');
    setStart('');
    setEnd('');
    setFile(null);
    setUrl('');
    setTab('upload');
  };

  const handleSubmit = async () => {
    try {
      setBusy(true);
      let res: CreateXttsCustomVoiceResponse | null = null;
      if (tab === 'upload') {
        if (!file) {
          throw new Error('Choose an audio file to upload.');
        }
        res = await createXttsCustomVoiceUpload(file, { label: label || undefined, start: start || undefined, end: end || undefined });
      } else {
        if (!url.trim()) throw new Error('Enter a YouTube URL.');
        res = await createXttsCustomVoiceFromYouTube(url.trim(), { label: label || undefined, start: start || undefined, end: end || undefined });
      }
      if (!res || !res.voice || !res.voice.id) throw new Error('Server did not return a voice.');
      onCreated({ id: res.voice.id, label: res.voice.label });
      reset();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Creation failed.';
      onError?.(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__dialog" role="dialog" aria-modal="true" aria-labelledby="xtts-custom-title">
        <header className="modal__header">
          <h2 id="xtts-custom-title">Create XTTS Custom Voice</h2>
          <div className="modal__subtitle">
            Provide a short clean sample (5–30 seconds). Ensure you have rights to use the audio.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }} role="tablist" aria-label="Source">
            <button type="button" role="tab" aria-selected={tab==='upload'} className={`modal__button ${tab==='upload' ? 'modal__button--primary' : ''}`} onClick={() => setTab('upload')}>Upload</button>
            <button type="button" role="tab" aria-selected={tab==='youtube'} className={`modal__button ${tab==='youtube' ? 'modal__button--primary' : ''}`} onClick={() => setTab('youtube')}>YouTube</button>
          </div>
        </header>
        <div className="modal__body">
          <label className="field">
            <span className="field__label">Label (optional)</span>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My custom voice" />
          </label>
          {tab === 'upload' ? (
            <>
              <label className="field">
                <span className="field__label">Audio file</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.wav,.mp3,.flac,.ogg"
                  onChange={(e) => setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
                />
              </label>
            </>
          ) : (
            <label className="field">
              <span className="field__label">YouTube URL</span>
              <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
            </label>
          )}
          <div className="grid grid--two">
            <label className="field">
              <span className="field__label">Start (mm:ss)</span>
              <input type="text" value={start} onChange={(e) => setStart(e.target.value)} placeholder="0:00" />
            </label>
            <label className="field">
              <span className="field__label">End (mm:ss)</span>
              <input type="text" value={end} onChange={(e) => setEnd(e.target.value)} placeholder="0:20" />
            </label>
          </div>
          <p className="panel__hint panel__hint--muted">Tip: keep samples clean (no music), clear speech, 5–30 seconds.</p>
        </div>
        <footer className="modal__footer">
          <button type="button" className="modal__button" onClick={onClose}>Cancel</button>
          <button type="button" className="modal__button modal__button--primary" onClick={handleSubmit} disabled={busy}>
            {busy ? 'Creating…' : 'Create voice'}
          </button>
        </footer>
      </div>
    </div>
  );
}

