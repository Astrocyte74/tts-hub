import { useCallback, useMemo, useRef } from 'react';

interface TextWorkbenchProps {
  text: string;
  onChange: (value: string) => void;
  onInsertRandom: () => void;
  onAppendRandom: () => void;
  isRandomLoading: boolean;
  categories: string[];
  selectedCategory: string;
  onCategoryChange: (value: string) => void;
  onAiAssistClick?: () => void;
  aiAssistAvailable?: boolean;
}

function formatDuration(seconds: number) {
  if (seconds <= 0) {
    return '0s';
  }
  if (seconds < 90) {
    return `${Math.max(1, Math.round(seconds))}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}m ${remaining}s`;
}

export function TextWorkbench({
  text,
  onChange,
  onInsertRandom,
  onAppendRandom,
  isRandomLoading,
  categories,
  selectedCategory,
  onCategoryChange,
  onAiAssistClick,
  aiAssistAvailable = false,
}: TextWorkbenchProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const wordCount = useMemo(() => {
    if (!text.trim()) {
      return 0;
    }
    return text
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
  }, [text]);
  const charCount = text.length;
  const estimatedDuration = useMemo(() => {
    if (!wordCount) {
      return 0;
    }
    const wordsPerMinute = 150;
    return (wordCount / wordsPerMinute) * 60;
  }, [wordCount]);

  const ssmlError = useMemo(() => {
    if (!text.includes('<')) {
      return null;
    }
    if (typeof DOMParser === 'undefined') {
      return null;
    }
    try {
      const parser = new DOMParser();
      const wrapped = `<speak>${text}</speak>`;
      const doc = parser.parseFromString(wrapped, 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) {
        return 'Check SSML syntax – tags appear to be unbalanced or malformed.';
      }
    } catch {
      return null;
    }
    return null;
  }, [text]);

  const insertSnippet = useCallback(
    (before: string, after = '', placeholder = '') => {
      const node = textareaRef.current;
      const value = text;
      if (!node) {
        return;
      }
      const start = node.selectionStart ?? value.length;
      const end = node.selectionEnd ?? value.length;
      const selection = start !== end ? value.slice(start, end) : placeholder;
      const nextValue = `${value.slice(0, start)}${before}${selection}${after}${value.slice(end)}`;
      onChange(nextValue);
      const nextStart = start + before.length;
      const nextEnd = nextStart + selection.length;
      requestAnimationFrame(() => {
        const current = textareaRef.current;
        if (!current) {
          return;
        }
        current.focus();
        current.setSelectionRange(nextStart, nextEnd);
      });
    },
    [onChange, text],
  );

  const handlePause = () => insertSnippet('<break time="500ms"/>');
  const handleEmphasis = () => insertSnippet('<emphasis level="strong">', '</emphasis>', 'Highlight this');
  const handlePitch = () => insertSnippet('<prosody pitch="+2st">', '</prosody>', 'Adjust pitch');
  const handleRate = () => insertSnippet('<prosody rate="slow">', '</prosody>', 'Adjust rate');

  return (
    <section className="panel">
      <header className="panel__header panel__header--stack">
        <div className="panel__heading">
          <h2 className="panel__title">Script</h2>
          <p className="panel__meta">
            {wordCount} {wordCount === 1 ? 'word' : 'words'} · {charCount} chars · ~{formatDuration(estimatedDuration)}
          </p>
        </div>
        <div className="panel__actions panel__actions--wrap">
          <label className="select">
            <span className="select__label">Random category</span>
            <select value={selectedCategory} onChange={(event) => onCategoryChange(event.target.value)}>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <button className="panel__button" type="button" onClick={onInsertRandom} disabled={isRandomLoading}>
            {isRandomLoading ? 'Fetching…' : 'Insert random'}
          </button>
          <button className="panel__button panel__button--ghost" type="button" onClick={onAppendRandom} disabled={isRandomLoading}>
            {isRandomLoading ? 'Fetching…' : 'Append random'}
          </button>
        </div>
      </header>

      <div className="textworkbench__toolbar" role="group" aria-label="Script helpers">
        <div className="textworkbench__helpers">
          <button type="button" className="chip-button" onClick={handlePause}>
            Pause
          </button>
          <button type="button" className="chip-button" onClick={handleEmphasis}>
            Emphasis
          </button>
          <button type="button" className="chip-button" onClick={handlePitch}>
            Pitch
          </button>
          <button type="button" className="chip-button" onClick={handleRate}>
            Rate
          </button>
        </div>
        <button
          type="button"
          className={`chip-button chip-button--accent ${!onAiAssistClick ? 'is-disabled' : ''}`}
          onClick={onAiAssistClick}
          disabled={!onAiAssistClick}
        >
          AI Assist {onAiAssistClick ? (aiAssistAvailable ? '· Ready' : '· Offline') : ''}
        </button>
      </div>

      <textarea
        ref={textareaRef}
        className={`textarea ${ssmlError ? 'textarea--invalid' : ''}`}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Type or paste the script you want to synthesise…"
        rows={10}
        aria-invalid={Boolean(ssmlError)}
      />
      {ssmlError ? <p className="form-hint form-hint--error">{ssmlError}</p> : null}
    </section>
  );
}
