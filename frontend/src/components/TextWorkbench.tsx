import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VoiceProfile } from '../types';

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
  // Context around selected voices for quick access
  voices?: VoiceProfile[];
  selectedVoiceIds?: string[];
  onGoToVoices?: () => void;
  // Optional editor font size override (px)
  editorFontSize?: number;
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
  voices = [],
  selectedVoiceIds = [],
  onGoToVoices,
  editorFontSize,
}: TextWorkbenchProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [randomOpen, setRandomOpen] = useState(false);
  const randomBtnRef = useRef<HTMLButtonElement | null>(null);
  const randomPanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!randomOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setRandomOpen(false);
    const onClick = (e: MouseEvent) => {
      const btn = randomBtnRef.current;
      const panel = randomPanelRef.current;
      const target = e.target as Node | null;
      if (!target) return;
      if ((btn && btn.contains(target)) || (panel && panel.contains(target))) return;
      setRandomOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
    };
  }, [randomOpen]);

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
          <h2 className="panel__title">Script Editor</h2>
          <span className="panel__crumb" aria-label="Step 2: Script">2 SCRIPT</span>
          <p className="panel__meta">
            {wordCount} {wordCount === 1 ? 'word' : 'words'} · {charCount} chars · ~{formatDuration(estimatedDuration)}
          </p>
          {Array.isArray(selectedVoiceIds) && selectedVoiceIds.length ? (
            <p className="panel__meta">
              Selected voice(s): {formatVoiceSummary(voices, selectedVoiceIds)}{' '}
              {onGoToVoices ? (
                <button type="button" className="link-button" onClick={onGoToVoices} aria-label="Change voices">
                  Change
                </button>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="panel__actions panel__actions--wrap">
          <span className={`status-pill ${aiAssistAvailable ? 'status-pill--ok' : 'status-pill--warn'}`} title={aiAssistAvailable ? 'Ollama connected' : 'Connect Ollama (see .env)'}>
            AI Assist · {aiAssistAvailable ? 'Ready' : 'Offline'}
          </span>
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
          <button
            ref={randomBtnRef}
            className="panel__button"
            type="button"
            onClick={() => setRandomOpen((v) => !v)}
            aria-expanded={randomOpen}
            aria-haspopup="menu"
            title="Random text options"
          >
            {isRandomLoading ? 'Fetching…' : 'Random…'}
          </button>
        </div>
      </header>
      <div className="textworkbench__toolbar" role="group" aria-label="Script helpers">
        <div style={{ flex: 1, minWidth: 260 }}>
          <button
            type="button"
            className="collapsible__toggle"
            aria-expanded={true}
            aria-controls="script-tools"
            title="Insert SSML helpers"
            onClick={() => {
              const el = document.getElementById('script-tools');
              if (el) el.toggleAttribute('hidden');
            }}
          >
            <span className="collapsible__chevron is-open" aria-hidden>
              ▶
            </span>
            <span className="panel__title" style={{ fontSize: 14, marginLeft: 6 }}>Script Tools</span>
          </button>
          <div id="script-tools" style={{ marginTop: 8 }}>
            <div className="textworkbench__helpers">
              <button type="button" className="chip-button" onClick={handlePause} title="Insert a 500ms pause">
                Pause
              </button>
              <button type="button" className="chip-button" onClick={handleEmphasis} title="Wrap selection with emphasis">
                Emphasis
              </button>
              <button type="button" className="chip-button" onClick={handlePitch} title="Wrap selection with pitch prosody">
                Pitch
              </button>
              <button type="button" className="chip-button" onClick={handleRate} title="Wrap selection with rate prosody">
                Rate
              </button>
            </div>
          </div>
        </div>
        <button
          type="button"
          className={`chip-button chip-button--accent ${!onAiAssistClick ? 'is-disabled' : ''}`}
          onClick={onAiAssistClick}
          disabled={!onAiAssistClick}
          title="Open AI Assist"
        >
          AI Assist
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
        style={editorFontSize ? ({ ['--editor-font-size' as any]: `${editorFontSize}px` } as React.CSSProperties) : undefined}
      />
      {ssmlError ? <p className="form-hint form-hint--error">{ssmlError}</p> : null}

      {randomOpen ? (
        <div className="popover" role="dialog" aria-label="Random text">
          <div className="popover__backdrop" onClick={() => setRandomOpen(false)} />
          <div ref={randomPanelRef} className="popover__panel" style={{ position: 'absolute', width: 220 }}>
            <div className="popover__content" role="menu">
              <button
                className="popover__button"
                type="button"
                role="menuitem"
                title="Replace editor with random text"
                onClick={() => {
                  setRandomOpen(false);
                  onInsertRandom();
                }}
                disabled={isRandomLoading}
              >
                {isRandomLoading ? 'Fetching…' : 'Insert random'}
              </button>
              <button
                className="popover__button"
                type="button"
                role="menuitem"
                title="Append random text as a new paragraph"
                onClick={() => {
                  setRandomOpen(false);
                  onAppendRandom();
                }}
                disabled={isRandomLoading}
              >
                {isRandomLoading ? 'Fetching…' : 'Append random'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatVoiceSummary(voices: VoiceProfile[], selectedVoiceIds: string[]) {
  if (!selectedVoiceIds.length) {
    return 'Pick a voice';
  }
  if (selectedVoiceIds.length === 1) {
    const id = selectedVoiceIds[0];
    const match = voices.find((voice) => voice.id === id);
    return match ? match.label : id;
  }
  if (selectedVoiceIds.length === 2) {
    const labels = selectedVoiceIds.map((id) => voices.find((voice) => voice.id === id)?.label ?? id);
    return `${labels[0]} + ${labels[1]}`;
  }
  const first = voices.find((voice) => voice.id === selectedVoiceIds[0])?.label ?? selectedVoiceIds[0];
  return `${first} + ${selectedVoiceIds.length - 1} more`;
}
