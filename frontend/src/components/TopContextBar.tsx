import { useEffect, useRef, useState } from 'react';
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
  onEngineClick?: () => void;
  onToggleResults?: () => void;
  onShowVoicePalette?: () => void;
  onShowInfo?: () => void;
  onAiAssistClick?: () => void;
  engines?: { id: string; label: string; available?: boolean; status?: string | null }[];
  onEngineChange?: (id: string) => void;
  activePanel?: 'script' | 'voices' | 'controls' | 'results';
  onChangePanel?: (panel: 'script' | 'voices' | 'controls' | 'results') => void;
  onShowScript?: () => void;
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
  activePanel,
  onChangePanel,
  onShowScript,
}: TopContextBarProps) {
  const voiceSummary = formatVoiceSummary(voices, selectedVoiceIds);
  const clipsCount = results.length;
  const statusLabel = engineReady ? 'Ready' : engineStatus || 'Not ready';
  const queueLabel = clipsCount === 1 ? '1 clip' : `${clipsCount} clips`;
  const hasRunning = queueRunning > 0;
  const noVoiceSelected = selectedVoiceIds.length === 0;

  // Clicking the engine chip navigates to full controls rather than showing a menu.

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
          onClick={onEngineClick ?? onOpenSettings}
          aria-label={`Active engine ${engineLabel} — change engine`}
          title="Change engine"
        >
          <span className="topbar__chip-label">Engine</span>
          <span className="topbar__chip-value">
            <span
              className="topbar__status-dot"
              aria-hidden
              style={{ marginRight: 6, background: engineReady ? '#22c55e' : '#eab308' }}
            />
            {engineLabel}
          </span>
        </button>
      </div>

      <div className="topbar__center">
        <button
          type="button"
          className={`topbar__chip ${activePanel === 'script' ? 'topbar__chip--active' : ''}`}
          onClick={() => {
            onChangePanel && onChangePanel('script');
            onShowScript && onShowScript();
          }}
          aria-label="Edit script"
          title="Script (1)"
        >
          <span className="topbar__chip-label">Script</span>
          <span className="topbar__chip-value">Text</span>
        </button>
        <button
          type="button"
          className={`topbar__chip ${noVoiceSelected ? 'topbar__chip--warn' : ''} ${activePanel === 'voices' ? 'topbar__chip--active' : ''}`}
          onClick={onShowVoicePalette}
          aria-label="Show voice palette"
          title="Jump to voices (V)"
        >
          <span className="topbar__chip-label">Voice</span>
          <span className="topbar__chip-value">{voiceSummary}</span>
        </button>
        {(queueTotal > 0 || clipsCount > 0) && (
          <button
            type="button"
            className={`topbar__chip ${activePanel === 'results' || isResultsOpen ? 'topbar__chip--active' : ''}`}
            onClick={() => {
              onChangePanel && onChangePanel('results');
              onToggleResults && onToggleResults();
            }}
            aria-pressed={activePanel === 'results' || Boolean(isResultsOpen)}
            aria-label="Show results"
            title="Results (4)"
          >
            <span className="topbar__chip-label">Clips</span>
            <span className="topbar__chip-value">{queueLabel}</span>
            {queueTotal > 0 ? (
              <span className="topbar__badge" title={`${queueTotal} in queue`} aria-label={`${queueTotal} in queue`}>
                {hasRunning ? `${queueRunning}/${queueTotal}` : `${queueTotal}`}
              </span>
            ) : null}
          </button>
        )}
      </div>

      <div className="topbar__right">
        <button type="button" className="topbar__button" onClick={onOpenSettings} aria-label="Open settings" title="Settings (S)">
          ⚙️
        </button>
        <button
          type="button"
          className="topbar__button topbar__button--primary"
          onClick={onQuickGenerate}
          disabled={!canGenerate || isGenerating}
          aria-label={isGenerating ? 'Generating' : 'Create clip'}
          aria-busy={isGenerating}
          title={canGenerate ? (isGenerating ? 'Generating…' : 'Create clip (G)') : 'Enter text and pick a voice'}
        >
          {isGenerating ? '⏳' : '▶️'}
          <span className="topbar__button-label">{isGenerating ? 'Generating…' : 'Create clip'}</span>
        </button>
      </div>

    </header>
  );
}
