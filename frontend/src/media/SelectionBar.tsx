import type { MediaTranscriptResult } from '../types';

interface Props {
  transcript: MediaTranscriptResult;
  selection: { start: number | null; end: number | null };
  onReplace: (text: string) => void;
  onPreview: () => void;
  onClear: () => void;
}

function joinWords(words: string[]): string {
  const needsNoSpace = (t: string) => /^[,.;:!?)]$/.test(t) || t.startsWith("'");
  const openNoSpaceAfter = /^[(\[\{]$/;
  let out = '';
  for (let i = 0; i < words.length; i += 1) {
    const t = String(words[i] ?? '').trim();
    if (!t) continue;
    const prev = i > 0 ? String(words[i - 1]) : '';
    const addSpace = i > 0 && !needsNoSpace(t) && !openNoSpaceAfter.test(prev);
    out += (addSpace ? ' ' : '') + t;
  }
  return out;
}

export function SelectionBar({ transcript, selection, onReplace, onPreview, onClear }: Props) {
  const start = selection.start ?? null;
  const end = selection.end ?? null;
  if (start === null || end === null || end <= start) return null;
  const dur = end - start;
  const words = (transcript.words || []).filter((w) => w.start >= start - 1e-3 && w.end <= end + 1e-3);
  const phrase = joinWords(words.map((w) => w.text));

  return (
    <div className="selection-bar" role="region" aria-label="Current selection">
      <div className="selection-bar__meta">{start.toFixed(2)}s → {end.toFixed(2)}s · {dur.toFixed(2)}s{words.length ? ` · ${words.length} words` : ''}</div>
      <div className="selection-bar__actions">
        <button type="button" className="panel__button" onClick={onPreview}>Preview selection</button>
        <button
          type="button"
          className="panel__button panel__button--primary"
          onClick={() => onReplace(phrase)}
          disabled={!phrase.trim()}
        >
          Replace…
        </button>
        <button type="button" className="panel__button" onClick={onClear}>Clear</button>
      </div>
    </div>
  );
}

