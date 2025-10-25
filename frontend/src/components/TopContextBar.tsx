import { useEffect, useRef, useState } from 'react';
import { IconBrand, IconCaretDown, IconCpu, IconDocument, IconMic, IconWave, IconPlay } from '../icons';
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
  quickFavorites?: { id: string; label: string }[];
  quickRecents?: { id: string; label: string }[];
  onQuickSelectVoice?: (id: string) => void;
  quickProfiles?: { id: string; label: string; engine: string; voiceId: string; notes?: string }[];
  onQuickSelectProfile?: (profile: { id: string; engine: string; voiceId: string }) => void;
  onEditFavorite?: (id: string) => void;
  onDeleteFavorite?: (id: string) => void;
  onOpenFavoritesManager?: () => void;
  onOpenApiStatus?: () => void;
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
  activePanel,
  onChangePanel,
  onShowScript,
  quickFavorites = [],
  quickRecents = [],
  onQuickSelectVoice,
  quickProfiles = [],
  onQuickSelectProfile,
  onEditFavorite,
  onDeleteFavorite,
  onOpenFavoritesManager,
  onOpenApiStatus,
}: TopContextBarProps) {
  const voiceSummary = formatVoiceSummary(voices, selectedVoiceIds);
  const clipsCount = results.length;
  const statusLabel = engineReady ? 'Ready' : engineStatus || 'Not ready';
  const queueLabel = clipsCount === 1 ? '1 clip' : `${clipsCount} clips`;
  const hasRunning = queueRunning > 0;
  const noVoiceSelected = selectedVoiceIds.length === 0;
  const voiceBtnRef = useRef<HTMLButtonElement | null>(null);
  const popoverPanelRef = useRef<HTMLDivElement | null>(null);
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
  const toolsBtnRef = useRef<HTMLButtonElement | null>(null);
  const toolsPopoverRef = useRef<HTMLDivElement | null>(null);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [hintQuick, setHintQuick] = useState(false);

  // Brief hint pulse when quick voices become available (first time)
  useEffect(() => {
    const available = (quickProfiles.length + quickFavorites.length + quickRecents.length) > 0;
    if (!available || voiceMenuOpen) return;
    let t: number | null = null;
    setHintQuick(true);
    t = window.setTimeout(() => setHintQuick(false), 1600);
    return () => { if (t) window.clearTimeout(t); };
  }, [quickProfiles.length, quickFavorites.length, quickRecents.length, voiceMenuOpen]);

  useEffect(() => {
    if (!voiceMenuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setVoiceMenuOpen(false);
    const onClick = (e: MouseEvent) => {
      const btn = voiceBtnRef.current;
      const panel = popoverPanelRef.current;
      const target = e.target as Node | null;
      if (!target) return;
      if ((btn && btn.contains(target)) || (panel && panel.contains(target))) {
        return; // clicks inside the button or popover should not close
      }
      setVoiceMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick); // not capture, so inner handlers can run
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
    };
  }, [voiceMenuOpen]);

  // Tools popover outside click handling
  useEffect(() => {
    if (!toolsMenuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setToolsMenuOpen(false);
    const onClick = (e: MouseEvent) => {
      const btn = toolsBtnRef.current;
      const panel = toolsPopoverRef.current;
      const target = e.target as Node | null;
      if (!target) return;
      if ((btn && btn.contains(target)) || (panel && panel.contains(target))) {
        return;
      }
      setToolsMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
    };
  }, [toolsMenuOpen]);

  // Clicking the engine chip navigates to full controls rather than showing a menu.

  return (
    <header className="topbar" role="banner" aria-label="Session context">
      <div className="topbar__left">
        <button type="button" className="topbar__brand" onClick={onShowInfo} aria-label="Open about dialog">
          <span className="topbar__brand-mark" aria-hidden>
            <IconBrand />
          </span>
          <span className="topbar__brand-label">Kokoro Playground</span>
        </button>
        <span className="topbar__divider" aria-hidden />
      </div>

      <div className="topbar__center topbar__modes" role="tablist" aria-label="Mode">
        <button
          type="button"
          role="tab"
          aria-selected={activePanel === 'script'}
          className={`topbar__chip ${activePanel === 'script' ? 'topbar__chip--active' : ''}`}
          onClick={() => {
            if (onChangePanel) {
              onChangePanel('script');
            }
            if (onShowScript) {
              onShowScript();
            }
          }}
          aria-label="Edit script"
          title="Script (1)"
        >
          <span className="topbar__chip-icon" aria-hidden><IconDocument /></span>
          <span className="topbar__chip-label">1&nbsp;Script</span>
          <span className="topbar__chip-value">Text</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activePanel === 'controls'}
          className={`topbar__chip ${activePanel === 'controls' ? 'topbar__chip--active' : ''}`}
          onClick={() => {
            if (onChangePanel) {
              onChangePanel('controls');
            }
            if (onEngineClick) {
              onEngineClick();
            }
          }}
          title={`Engine (2) — ${statusLabel}`}
        >
          <span className="topbar__chip-icon" aria-hidden><IconCpu /></span>
          <span className="topbar__chip-label">2&nbsp;Engine</span>
          <span className="topbar__chip-value">
            <span className="topbar__status-dot" aria-hidden style={{ marginRight: 6, background: engineReady ? '#22c55e' : '#eab308' }} />
            {engineLabel}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activePanel === 'voices'}
          className={`topbar__chip ${activePanel === 'voices' ? 'topbar__chip--active' : ''} ${!engineReady ? 'topbar__chip--muted' : ''} ${noVoiceSelected && activePanel === 'voices' ? 'topbar__chip--warn' : ''}`}
          onClick={() => {
            if (onChangePanel) {
              onChangePanel('voices');
            }
            if (onShowVoicePalette) {
              onShowVoicePalette();
            }
          }}
          aria-label="Show voice palette"
          title={engineReady ? 'Jump to voices (V)' : 'Select an engine first'}
          ref={voiceBtnRef}
        >
          <span className="topbar__chip-icon" aria-hidden><IconMic /></span>
          <span className="topbar__chip-label">3&nbsp;Voice</span>
          <span className="topbar__chip-value">{voiceSummary}</span>
          {(quickProfiles.length > 0 || quickFavorites.length > 0 || quickRecents.length > 0) ? (
            <span
              className={`topbar__badge ${hintQuick ? 'topbar__badge--pulse' : ''}`}
              title="Quick voices"
              aria-label="Open quick voices"
              onClick={(e) => {
                e.stopPropagation();
                setVoiceMenuOpen((v) => !v);
              }}
            >
              <IconCaretDown />
            </span>
          ) : null}
        </button>
        {(queueTotal > 0 || clipsCount > 0) && (
          <button
            type="button"
            role="tab"
            aria-selected={activePanel === 'results' || Boolean(isResultsOpen)}
            className={`topbar__chip ${activePanel === 'results' || isResultsOpen ? 'topbar__chip--active' : ''}`}
            onClick={() => {
              if (onChangePanel) {
                onChangePanel('results');
              }
              if (onToggleResults) {
                onToggleResults();
              }
            }}
            aria-label="Show results"
            title="Results (4)"
          >
            <span className="topbar__chip-icon" aria-hidden><IconWave /></span>
            <span className="topbar__chip-label">4&nbsp;Clips</span>
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
        <button
          type="button"
          className="topbar__button"
          ref={toolsBtnRef}
          onClick={() => setToolsMenuOpen((v) => !v)}
          aria-expanded={toolsMenuOpen}
          aria-haspopup="menu"
          aria-label="Open tools menu"
          title="Tools"
        >
          ⋯
          <span className="topbar__button-label">Tools</span>
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
          {isGenerating ? '⏳' : <IconPlay />}
          <span className="topbar__button-label">{isGenerating ? 'Generating…' : 'Create clip'}</span>
        </button>
      </div>

      {voiceMenuOpen && (quickProfiles.length > 0 || quickFavorites.length > 0 || quickRecents.length > 0) ? (
        <div className="popover" role="dialog" aria-label="Quick voices">
          <div className="popover__backdrop" />
          <div ref={popoverPanelRef} className="popover__panel" style={{ position: 'absolute', top: 56, right: 160, width: 300 }}>
            <div className="popover__header"><h3 className="popover__title">Quick select</h3></div>
            <div className="popover__content">
              {quickProfiles.length > 0 ? (
                <div>
                  <strong>Favorites</strong>
                  {quickProfiles.map((p) => (
                    <div key={`prof-${p.id}`} className="popover__item">
                      <button
                        className="popover__button"
                        type="button"
                        title={(p.notes && p.notes.trim()) ? p.notes : `${p.engine} · ${p.voiceId}`}
                        onClick={() => {
                          if (onQuickSelectProfile) {
                            onQuickSelectProfile({ id: p.id, engine: p.engine, voiceId: p.voiceId });
                          }
                          setVoiceMenuOpen(false);
                        }}
                      >
                        {p.label}
                      </button>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {onEditFavorite ? (
                          <button
                            className="popover__button"
                            type="button"
                            title="Edit favorite"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditFavorite(p.id);
                              setVoiceMenuOpen(false);
                            }}
                          >
                            ✎
                          </button>
                        ) : null}
                        {onDeleteFavorite ? (
                          <button
                            className="popover__button"
                            type="button"
                            title="Delete favorite"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteFavorite(p.id);
                              setVoiceMenuOpen(false);
                            }}
                          >
                            🗑
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {onOpenFavoritesManager ? (
                    <div style={{ marginTop: 8 }}>
                      <button
                        className="popover__button"
                        type="button"
                        onClick={() => {
                          onOpenFavoritesManager();
                          setVoiceMenuOpen(false);
                        }}
                      >
                        Manage Favorites…
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {quickFavorites.length > 0 ? (
                <div>
                  <strong>Favorites</strong>
                  {quickFavorites.map((v) => (
                    <button
                      key={`fav-${v.id}`}
                      className="popover__button"
                      type="button"
                      onClick={() => {
                        if (onQuickSelectVoice) {
                          onQuickSelectVoice(v.id);
                        }
                        setVoiceMenuOpen(false);
                      }}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {quickRecents.length > 0 ? (
                <div>
                  <strong>Recent</strong>
                  {quickRecents.map((v) => (
                    <button
                      key={`rec-${v.id}`}
                      className="popover__button"
                      type="button"
                      onClick={() => {
                        if (onQuickSelectVoice) {
                          onQuickSelectVoice(v.id);
                        }
                        setVoiceMenuOpen(false);
                      }}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {toolsMenuOpen ? (
        <div className="popover" role="dialog" aria-label="Tools">
          <div className="popover__backdrop" />
          <div ref={toolsPopoverRef} className="popover__panel" style={{ position: 'absolute', top: 56, right: 12, width: 240 }}>
            <div className="popover__header"><h3 className="popover__title">Tools</h3></div>
            <div className="popover__content" role="menu">
              <button
                className="popover__button"
                type="button"
                role="menuitem"
                onClick={() => {
                  setToolsMenuOpen(false);
                  onOpenApiStatus && onOpenApiStatus();
                }}
                title="API & CLI"
              >
                API & CLI
              </button>
              <button
                className="popover__button"
                type="button"
                role="menuitem"
                onClick={() => {
                  setToolsMenuOpen(false);
                  try {
                    window.location.hash = '#media';
                  } catch {}
                }}
                title="Open Media Editor"
              >
                Media Editor
              </button>
              <button
                className="popover__button"
                type="button"
                role="menuitem"
                disabled={!ollamaAvailable || !onAiAssistClick}
                onClick={() => {
                  setToolsMenuOpen(false);
                  onAiAssistClick && onAiAssistClick();
                }}
                title={ollamaAvailable ? 'AI Assist (Shift + /)' : 'AI Assist unavailable'}
              >
                AI Assist
              </button>
              <button
                className="popover__button"
                type="button"
                role="menuitem"
                onClick={() => {
                  setToolsMenuOpen(false);
                  onOpenSettings && onOpenSettings();
                }}
                title="Settings (S)"
              >
                Settings
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </header>
  );
}
