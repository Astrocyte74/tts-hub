import type { SynthesisResult, VoiceProfile } from '../types';

interface TopContextBarProps {
  engineLabel: string;
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
  onToggleResults?: () => void;
  onShowVoicePalette?: () => void;
  onShowInfo?: () => void;
  onAiAssistClick?: () => void;
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
  onToggleResults,
  onShowVoicePalette,
  onShowInfo,
  onAiAssistClick,
}: TopContextBarProps) {
  const voiceSummary = formatVoiceSummary(voices, selectedVoiceIds);
  const clipsCount = results.length;
  const statusLabel = engineReady ? 'Ready' : engineStatus || 'Not ready';
  const queueLabel = clipsCount === 1 ? '1 clip' : `${clipsCount} clips`;
  const hasRunning = queueRunning > 0;
  const noVoiceSelected = selectedVoiceIds.length === 0;

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
          onClick={onOpenSettings}
          aria-label={`Active engine ${engineLabel}`}
          title="Settings (S)"
        >
          <span className="topbar__chip-label">Engine</span>
          <span className="topbar__chip-value">{engineLabel}</span>
        </button>
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
        <span
          className={`topbar__status ${engineReady ? 'topbar__status--ok' : 'topbar__status--warn'}`}
          role="status"
          aria-live="polite"
        >
          <span className="topbar__status-dot" aria-hidden />
          <span>{statusLabel}</span>
        </span>
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
    </header>
  );
}
