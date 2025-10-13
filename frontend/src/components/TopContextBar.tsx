import type { SynthesisResult, VoiceProfile } from '../types';

interface TopContextBarProps {
  engineLabel: string;
  engineStatus?: string | null;
  engineReady: boolean;
  voices: VoiceProfile[];
  selectedVoiceIds: string[];
  results: SynthesisResult[];
  onQuickGenerate?: () => void;
  onOpenSettings?: () => void;
  onToggleResults?: () => void;
}

export function TopContextBar({
  engineLabel,
  engineStatus,
  engineReady,
  voices,
  selectedVoiceIds,
  results,
  onQuickGenerate,
  onOpenSettings,
  onToggleResults,
}: TopContextBarProps) {
  const selectedCount = selectedVoiceIds.length;
  const firstSelected = selectedVoiceIds[0];
  const firstLabel = voices.find((v) => v.id === firstSelected)?.label || firstSelected || '—';
  const clipsCount = results.length;
  const statusLabel = engineReady ? 'Ready' : engineStatus || 'Not ready';

  return (
    <div className="topbar" role="navigation" aria-label="Context bar">
      <div className="topbar__left">
        <span className="topbar__brand" aria-label="App name">Kokoro Playground</span>
        <span className="topbar__sep" aria-hidden>•</span>
        <span className="topbar__engine" aria-label="Active engine">{engineLabel}</span>
      </div>
      <div className="topbar__center">
        <span className="topbar__summary" aria-label="Selection summary">
          {selectedCount > 1 ? `${selectedCount} voices selected` : `Voice: ${firstLabel}`}
        </span>
        <span className="topbar__sep" aria-hidden>•</span>
        <button className="topbar__pill" type="button" onClick={onToggleResults} aria-label="Open results drawer">
          {clipsCount} {clipsCount === 1 ? 'clip' : 'clips'}
        </button>
      </div>
      <div className="topbar__right">
        <span className={`topbar__status ${engineReady ? 'topbar__status--ok' : 'topbar__status--warn'}`} aria-label="Engine status">
          {statusLabel}
        </span>
        <button type="button" className="topbar__button" onClick={onOpenSettings} aria-label="Open settings">
          ⚙️ Settings
        </button>
        <button
          type="button"
          className="topbar__button topbar__button--primary"
          onClick={onQuickGenerate}
          aria-label="Quick generate"
        >
          ▶️ Quick Generate
        </button>
      </div>
    </div>
  );
}

