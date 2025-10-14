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
  onQuickGenerate?: () => void;
  onOpenSettings?: () => void;
  onToggleResults?: () => void;
  onShowVoicePalette?: () => void;
  onShowInfo?: () => void;
}

function formatVoiceSummary(voices: VoiceProfile[], selectedVoiceIds: string[]) {
  if (!selectedVoiceIds.length) {
    return 'No voice selected';
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
  onQuickGenerate,
  onOpenSettings,
  onToggleResults,
  onShowVoicePalette,
  onShowInfo,
}: TopContextBarProps) {
  const voiceSummary = formatVoiceSummary(voices, selectedVoiceIds);
  const clipsCount = results.length;
  const statusLabel = engineReady ? 'Ready' : engineStatus || 'Not ready';
  const queueLabel = clipsCount === 1 ? '1 clip' : `${clipsCount} clips`;
  const hasRunning = queueRunning > 0;

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
        >
          <span className="topbar__chip-label">Engine</span>
          <span className="topbar__chip-value">{engineLabel}</span>
        </button>
      </div>

      <div className="topbar__center">
        <button type="button" className="topbar__chip" onClick={onShowVoicePalette} aria-label="Show voice palette">
          <span className="topbar__chip-label">Voice</span>
          <span className="topbar__chip-value">{voiceSummary}</span>
        </button>
        <button
          type="button"
          className={`topbar__chip ${isResultsOpen ? 'topbar__chip--active' : ''}`}
          onClick={onToggleResults}
          aria-label={isResultsOpen ? 'Hide results drawer' : 'Show results drawer'}
        >
          <span className="topbar__chip-label">Clips</span>
          <span className="topbar__chip-value">{queueLabel}</span>
          {queueTotal > 0 ? (
            <span className="topbar__badge" title={`${queueTotal} in queue`} aria-label={`${queueTotal} in queue`}>
              {hasRunning ? `${queueRunning}/${queueTotal}` : `${queueTotal}`}
            </span>
          ) : null}
        </button>
        <span className={`topbar__status ${engineReady ? 'topbar__status--ok' : 'topbar__status--warn'}`} role="status">
          <span className="topbar__status-dot" aria-hidden />
          <span>{statusLabel}</span>
        </span>
      </div>

      <div className="topbar__right">
        <span
          className={`topbar__chip ${ollamaAvailable ? 'topbar__chip--muted' : 'topbar__chip--warn'}`}
          aria-label={ollamaAvailable ? 'Ollama connected' : 'Ollama offline'}
        >
          <span className="topbar__chip-label">AI Assist</span>
          <span className="topbar__chip-value">{ollamaAvailable ? 'Ready' : 'Offline'}</span>
        </span>
        <button type="button" className="topbar__button" onClick={onOpenSettings} aria-label="Open settings">
          ⚙️
        </button>
        <button
          type="button"
          className="topbar__button topbar__button--primary"
          onClick={onQuickGenerate}
          disabled={!canGenerate}
          aria-label="Quick generate"
        >
          ▶️
          <span className="topbar__button-label">Quick Generate</span>
        </button>
      </div>
    </header>
  );
}
