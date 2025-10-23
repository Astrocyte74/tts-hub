import type { JSX } from 'react';
import { IconChatTTS, IconKokoro, IconOpenVoice, IconXTTS } from '../icons';

interface EngineOption {
  id: string;
  label: string;
  available: boolean;
  status?: string;
  description?: string;
}

interface KokoroFavoriteOption {
  id: string;
  label: string;
  voiceLabel: string;
  voiceId: string;
  accentLabel?: string;
  notes?: string;
  unavailable?: boolean;
}

interface SynthesisControlsProps {
  engineId: string;
  engines: EngineOption[];
  onEngineChange: (value: string) => void;
  engineAvailable: boolean;
  engineMessage?: string;
  language: string;
  languages: string[];
  onLanguageChange: (value: string) => void;
  speed: number;
  onSpeedChange: (value: number) => void;
  trimSilence: boolean;
  onTrimSilenceChange: (value: boolean) => void;
  autoPlay: boolean;
  onAutoPlayChange: (value: boolean) => void;
  styleOptions?: string[];
  selectedStyle?: string;
  onStyleChange?: (value: string) => void;
  chatttsSeed?: string;
  onChatttsSeedChange?: (value: string) => void;
  kokoroFavoriteId?: string;
  kokoroFavoriteOptions?: KokoroFavoriteOption[];
  onKokoroFavoriteChange?: (value: string) => void;
  onManageKokoroFavorites?: () => void;
  kokoroFavoritesCount?: number;
  hideLanguageSpeed?: boolean;
}

export function SynthesisControls({
  engineId,
  engines,
  onEngineChange,
  engineAvailable,
  engineMessage,
  language,
  languages,
  onLanguageChange,
  speed,
  onSpeedChange,
  trimSilence,
  onTrimSilenceChange,
  autoPlay,
  onAutoPlayChange,
  styleOptions = [],
  selectedStyle,
  onStyleChange,
  chatttsSeed,
  onChatttsSeedChange,
  kokoroFavoriteId,
  kokoroFavoriteOptions = [],
  onKokoroFavoriteChange,
  onManageKokoroFavorites,
  kokoroFavoritesCount,
  hideLanguageSpeed = false,
}: SynthesisControlsProps) {
  const selectedEngine = engines.find((engine) => engine.id === engineId);
  const description = engineMessage ?? selectedEngine?.description;
  const status = selectedEngine?.status;
  const selectedKokoroFavorite = kokoroFavoriteId
    ? kokoroFavoriteOptions.find((favorite) => favorite.id === kokoroFavoriteId)
    : undefined;

  return (
    <section className="panel">
      <header className="panel__header">
        <div className="panel__heading">
          <h2 className="panel__title">Text‑to‑Speech Engine (TTS Engine)</h2>
          <span className="panel__crumb" aria-label="Step 1: Engine">1 ENGINE</span>
        </div>
      </header>
      <div className="field">
        <span className="field__label">TTS Engine</span>
        <div className="engine-cards" role="list" aria-label="Choose engine">
          {engines.map((engine) => {
            const selected = engine.id === engineId;
            const blurbs: Record<string, { tagline: string; strengths: string[]; helpUrl: string; icon: JSX.Element }> = {
              kokoro: {
                tagline: 'Local, fast, natural multi-speaker voices',
                strengths: ['Offline', 'Great default voices', 'Snappy'],
                helpUrl: 'https://github.com/Astrocyte74/tts-hub#kokoro-onnx',
                icon: <IconKokoro />,
              },
              openvoice: {
                tagline: 'Clone any speaker from short references',
                strengths: ['Custom voices', 'Reference-driven'],
                helpUrl: 'https://github.com/Astrocyte74/tts-hub#openvoice',
                icon: <IconOpenVoice />,
              },
              chattts: {
                tagline: 'Dialogue-style TTS, flexible tone via seeds',
                strengths: ['Conversational', 'Seed control'],
                helpUrl: 'https://github.com/Astrocyte74/tts-hub#chattts',
                icon: <IconChatTTS />,
              },
              xtts: {
                tagline: 'Server-based XTTS model for consistent long-form',
                strengths: ['Server persistent', 'Long clips'],
                helpUrl: 'https://github.com/Astrocyte74/tts-hub#xtts-v2',
                icon: <IconXTTS />,
              },
            };
            const info = blurbs[engine.id as keyof typeof blurbs];
            return (
              <button
                key={engine.id}
                className={`engine-card ${selected ? 'is-selected' : ''}`}
                type="button"
                role="listitem"
                aria-pressed={selected}
                disabled={!engine.available}
                onClick={() => onEngineChange(engine.id)}
                title={engine.status ?? ''}
              >
                <div className="engine-card__row">
                  <span className="engine-card__icon" aria-hidden>
                    {info?.icon}
                  </span>
                  <div className="engine-card__title-group">
                    <div className="engine-card__title">{engine.label}</div>
                    <div className="engine-card__tagline">{info?.tagline ?? engine.description ?? ''}</div>
                  </div>
                  {info?.helpUrl ? (
                    <a
                      className="engine-card__help"
                      href={info.helpUrl}
                      onClick={(e) => e.stopPropagation()}
                      target="_blank"
                      rel="noreferrer"
                      title={`Open ${engine.label} quickstart`}
                      aria-label={`Open ${engine.label} quickstart`}
                    >
                      ?
                    </a>
                  ) : null}
                </div>
                <div className="engine-card__badges">
                  {(info?.strengths ?? []).map((s) => (
                    <span key={s} className="engine-badge">{s}</span>
                  ))}
                  {!engine.available ? <span className="engine-badge engine-badge--warn">Unavailable</span> : null}
                </div>
              </button>
            );
          })}
        </div>
        {/* Accessible fallback */}
        <select value={engineId} onChange={(e) => onEngineChange(e.target.value)} style={{ position: 'absolute', left: -9999 }} aria-hidden />
        {description ? <p className="panel__hint panel__hint--muted">{description}</p> : null}
        {!engineAvailable ? (
          <p className="panel__hint panel__hint--warning">This engine is not ready yet. Choose another engine or complete its setup.</p>
        ) : null}
        {engineAvailable && status && status !== 'ready' ? (
          <p className="panel__hint panel__hint--notice">Status: {status}</p>
        ) : null}
      </div>
      {styleOptions.length && onStyleChange ? (
        <label className="field">
          <span className="field__label">Style</span>
          <select
            value={selectedStyle ?? (styleOptions[0] ?? 'default')}
            onChange={(event) => onStyleChange(event.target.value)}
            disabled={!engineAvailable}
          >
            {styleOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            {selectedStyle && !styleOptions.includes(selectedStyle) ? (
              <option value={selectedStyle}>{selectedStyle}</option>
            ) : null}
          </select>
        </label>
      ) : null}
      {kokoroFavoriteOptions.length && onKokoroFavoriteChange ? (
        <label className="field">
          <span className="field__label">Kokoro Favorite</span>
          <select
            value={kokoroFavoriteId ?? ''}
            onChange={(event) => onKokoroFavoriteChange(event.target.value)}
            disabled={!engineAvailable}
          >
            <option value="">None selected</option>
            {kokoroFavoriteOptions.map((favorite) => (
              <option key={favorite.id} value={favorite.id}>
                {favorite.label} · {favorite.voiceLabel}
                {favorite.accentLabel ? ` (${favorite.accentLabel})` : ''}
                {favorite.unavailable ? ' (missing)' : ''}
              </option>
            ))}
            {kokoroFavoriteId &&
            kokoroFavoriteId !== '' &&
            !kokoroFavoriteOptions.some((favorite) => favorite.id === kokoroFavoriteId) ? (
              <option value={kokoroFavoriteId}>{kokoroFavoriteId}</option>
            ) : null}
          </select>
          {selectedKokoroFavorite && selectedKokoroFavorite.notes ? (
            <p className="panel__hint panel__hint--muted">{selectedKokoroFavorite.notes}</p>
          ) : (
            <p className="panel__hint panel__hint--muted">Load a saved favorite to jump straight to its Kokoro voice.</p>
          )}
          {selectedKokoroFavorite && selectedKokoroFavorite.unavailable ? (
            <p className="panel__hint panel__hint--warning">
              Voice missing from the current catalogue. Reinstall assets or update favorites.
            </p>
          ) : null}
        </label>
      ) : null}
      {onManageKokoroFavorites ? (
        <div className="field__actions">
          <button type="button" className="panel__button panel__button--ghost" onClick={onManageKokoroFavorites}>
            Manage favorites
            {typeof kokoroFavoritesCount === 'number' && kokoroFavoritesCount > 0 ? ` (${kokoroFavoritesCount})` : ''}
          </button>
        </div>
      ) : null}
      {onChatttsSeedChange ? (
        <label className="field">
          <span className="field__label">ChatTTS Seed</span>
          <input
            type="number"
            min={0}
            step={1}
            value={chatttsSeed ?? ''}
            onChange={(event) => onChatttsSeedChange(event.target.value)}
            placeholder="random each run"
            disabled={!engineAvailable}
          />
          <div>
            <button type="button" onClick={() => onChatttsSeedChange('')} disabled={!engineAvailable}>
              Clear
            </button>
            <button
              type="button"
              onClick={() => onChatttsSeedChange(String(Math.floor(Math.random() * 1_000_000)))}
              disabled={!engineAvailable}
            >
              Randomise
            </button>
          </div>
          <p className="panel__hint panel__hint--muted">Set a seed to reuse the random speaker without saving a preset.</p>
        </label>
      ) : null}
      {!hideLanguageSpeed ? (
        <div className="grid grid--two">
          <label className="field">
            <span className="field__label">Language</span>
            <select value={language} onChange={(event) => onLanguageChange(event.target.value)}>
              {languages.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              {!languages.includes(language) ? <option value={language}>{language}</option> : null}
            </select>
          </label>
          <label className="field">
            <span className="field__label">
              Speed <span className="field__value">{speed.toFixed(2)}×</span>
            </span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={speed}
              onChange={(event) => onSpeedChange(parseFloat(event.target.value))}
            />
          </label>
        </div>
      ) : null}
      <div className="toggle-list">
        <label className="toggle">
          <input type="checkbox" checked={trimSilence} onChange={(event) => onTrimSilenceChange(event.target.checked)} />
          <span>Trim silence</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={autoPlay} onChange={(event) => onAutoPlayChange(event.target.checked)} />
          <span>Autoplay new clips</span>
        </label>
      </div>
    </section>
  );
}
