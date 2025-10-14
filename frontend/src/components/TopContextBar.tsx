import { useEffect, useRef, useState } from 'react';
import type { SynthesisResult, VoiceProfile } from '../types';

interface TopContextBarProps {
  engineLabel: string;
  engineId?: string;
  engineStatus?: string | null;
  engineReady: boolean;
  voices: VoiceProfile[];
  selectedVoiceIds: string[];
  results: SynthesisResult[];
  queueRunning?: number;
  queueTotal?: number;
  ollamaAvailable?: boolean;
  isResultsOpen?: boolean;
  canGenerate?: boolean;
  isGenerating?: boolean;
  onQuickGenerate?: () => void;
  onOpenSettings?: () => void;
  onEngineClick?: () => void;
  onToggleResults?: () => void;
  onShowVoicePalette?: () => void;
  onShowInfo?: () => void;
  onAiAssistClick?: () => void;
  engines?: { id: string; label: string; available?: boolean; status?: string | null }[];
  onEngineChange?: (id: string) => void;
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

export function TopContextBar({
  engineLabel,
  engineStatus,
  engineReady,
  voices,
  selectedVoiceIds,
  results,
  queueRunning = 0,
  queueTotal = 0,
  ollamaAvailable = false,
  isResultsOpen = false,
  canGenerate = true,
  isGenerating = false,
  onQuickGenerate,
  onOpenSettings,
  onEngineClick,
  onToggleResults,
  onShowVoicePalette,
  onShowInfo,
  onAiAssistClick,
  engines,
  onEngineChange,
}: TopContextBarProps) {
  const voiceSummary = formatVoiceSummary(voices, selectedVoiceIds);
  const clipsCount = results.length;
  const statusLabel = engineReady ? 'Ready' : engineStatus || 'Not ready';
  const queueLabel = clipsCount === 1 ? '1 clip' : `${clipsCount} clips`;
  const hasRunning = queueRunning > 0;
  const noVoiceSelected = selectedVoiceIds.length === 0;

  const [engineMenuOpen, setEngineMenuOpen] = useState(false);
  const engineBtnRef = useRef<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!engineMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEngineMenuOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      const el = engineBtnRef.current;
      if (!el) return;
      if (!(e.target instanceof Node)) return;
      if (!el.contains(e.target)) setEngineMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick, { capture: true } as any);
    };
  }, [engineMenuOpen]);

  const openEngineMenu = () => {
    if (!engines || !engines.length) {
      if (onEngineClick) onEngineClick();
      else if (onOpenSettings) onOpenSettings();
      return;
    }
    const rect = engineBtnRef.current?.getBoundingClientRect();
    if (rect) setMenuPos({ top: Math.round(rect.bottom + 8), left: Math.round(rect.left) });
    setEngineMenuOpen((v) => !v);
  };

  return (
    <header className="topbar" role="banner" aria-label="Session context">
      <div className="topbar__left">
        <button type="button" className="topbar__brand" onClick={onShowInfo} aria-label="Open about dialog">
          <span className="topbar__brand-mark" aria-hidden>⧉</span>
          <span className="topbar__brand-label">Kokoro Playground</span>
        </button>
        <span className="topbar__divider" aria-hidden />
        <button
          type="button"
          className="topbar__chip topbar__chip--muted"
          onClick={openEngineMenu}
          aria-label={`Active engine ${engineLabel} — change engine`}
          title={engines && engines.length ? 'Change engine' : 'Open engine settings'}
          ref={engineBtnRef}
        >
          <span className="topbar__chip-label">Engine</span>
          <span className="topbar__chip-value">{engineLabel}</span>
        </button>
        <span
          className={`topbar__status ${engineReady ? 'topbar__status--ok' : 'topbar__status--warn'}`}
          role="status"
          aria-live="polite"
        >
          <span className="topbar__status-dot" aria-hidden />
          <span>{statusLabel}</span>
        </span>
      </div>

      <div className="topbar__center">
        <button
          type="button"
          className={`topbar__chip ${noVoiceSelected ? 'topbar__chip--warn' : ''}`}
          onClick={onShowVoicePalette}
          aria-label="Show voice palette"
          title="Jump to voices (V)"
        >
          <span className="topbar__chip-label">Voice</span>
          <span className="topbar__chip-value">{voiceSummary}</span>
        </button>
        <button
          type="button"
          className={`topbar__chip ${isResultsOpen ? 'topbar__chip--active' : ''}`}
          onClick={onToggleResults}
          aria-pressed={isResultsOpen}
          aria-label={isResultsOpen ? 'Hide results drawer' : 'Show results drawer'}
          title="Toggle results (R)"
        >
          <span className="topbar__chip-label">Clips</span>
          <span className="topbar__chip-value">{queueLabel}</span>
          {queueTotal > 0 ? (
            <span className="topbar__badge" title={`${queueTotal} in queue`} aria-label={`${queueTotal} in queue`}>
              {hasRunning ? `${queueRunning}/${queueTotal}` : `${queueTotal}`}
            </span>
          ) : null}
        </button>
      </div>

      <div className="topbar__right">
        <button
          type="button"
          className={`topbar__chip ${ollamaAvailable ? '' : 'topbar__chip--warn'}`}
          onClick={onAiAssistClick}
          aria-label={ollamaAvailable ? 'Open AI Assist' : 'Ollama offline – learn how to enable'}
          title={ollamaAvailable ? 'Open AI Assist' : 'Ollama offline – click for help'}
        >
          <span className="topbar__chip-label">AI Assist</span>
          <span className="topbar__chip-value">{ollamaAvailable ? 'Ready' : 'Offline'}</span>
        </button>
        <button type="button" className="topbar__button" onClick={onOpenSettings} aria-label="Open settings" title="Settings (S)">
          ⚙️
        </button>
        <button
          type="button"
          className="topbar__button topbar__button--primary"
          onClick={onQuickGenerate}
          disabled={!canGenerate || isGenerating}
          aria-label={isGenerating ? 'Generating' : 'Quick generate'}
          aria-busy={isGenerating}
          title={canGenerate ? (isGenerating ? 'Generating…' : 'Quick Generate (G)') : 'Select a voice and enter text'}
        >
          {isGenerating ? '⏳' : '▶️'}
          <span className="topbar__button-label">{isGenerating ? 'Generating…' : 'Quick Generate'}</span>
        </button>
      </div>

      {engineMenuOpen && engines && engines.length ? (
        <div className="popover" role="dialog" aria-label="Change engine">
          <div className="popover__backdrop" />
          <div
            className="popover__panel"
            style={{ position: 'absolute', top: menuPos?.top ?? 64, left: menuPos?.left ?? 24, width: 320 }}
          >
            <div className="popover__header">
              <h3 className="popover__title">Choose engine</h3>
            </div>
            <div className="popover__content" role="list">
              {engines.map((e) => {
                const disabled = e.available === false;
                return (
                  <button
                    key={e.id}
                    type="button"
                    className="popover__button"
                    aria-disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      onEngineChange && onEngineChange(e.id);
                      setEngineMenuOpen(false);
                    }}
                    title={e.status ?? ''}
                  >
                    {e.label} {disabled ? '· Unavailable' : ''}
                  </button>
                );
              })}
            </div>
            <div className="popover__footer">
              <button
                type="button"
                className="popover__button"
                onClick={() => {
                  setEngineMenuOpen(false);
                  if (onEngineClick) onEngineClick();
                  else if (onOpenSettings) onOpenSettings();
                }}
              >
                More settings…
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
