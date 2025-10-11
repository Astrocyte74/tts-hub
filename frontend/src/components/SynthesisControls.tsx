interface EngineOption {
  id: string;
  label: string;
  available: boolean;
  status?: string;
  description?: string;
}

interface ChatttsPresetOption {
  id: string;
  label: string;
  notes?: string;
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
  chatttsPresetId?: string;
  chatttsPresetOptions?: ChatttsPresetOption[];
  onChatttsPresetChange?: (value: string) => void;
  chatttsSeed?: string;
  onChatttsSeedChange?: (value: string) => void;
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
  chatttsPresetId,
  chatttsPresetOptions = [],
  onChatttsPresetChange,
  chatttsSeed,
  onChatttsSeedChange,
}: SynthesisControlsProps) {
  const selectedEngine = engines.find((engine) => engine.id === engineId);
  const description = engineMessage ?? selectedEngine?.description;
  const status = selectedEngine?.status;

  return (
    <section className="panel">
      <header className="panel__header">
        <h2 className="panel__title">Settings</h2>
      </header>
      <div className="field">
        <span className="field__label">TTS Engine</span>
        <select value={engineId} onChange={(event) => onEngineChange(event.target.value)}>
          {engines.map((engine) => (
            <option key={engine.id} value={engine.id} disabled={!engine.available}>
              {engine.label}
              {!engine.available ? ' (unavailable)' : ''}
            </option>
          ))}
          {!engines.some((engine) => engine.id === engineId) ? <option value={engineId}>{engineId}</option> : null}
        </select>
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
      {chatttsPresetOptions.length && onChatttsPresetChange ? (
        <label className="field">
          <span className="field__label">ChatTTS Speaker</span>
          <select
            value={chatttsPresetId ?? 'random'}
            onChange={(event) => onChatttsPresetChange(event.target.value)}
            disabled={!engineAvailable}
          >
            <option value="random">Random speaker</option>
            {chatttsPresetOptions.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
            {chatttsPresetId &&
            chatttsPresetId !== 'random' &&
            !chatttsPresetOptions.some((preset) => preset.id === chatttsPresetId) ? (
              <option value={chatttsPresetId}>{chatttsPresetId}</option>
            ) : null}
          </select>
          {chatttsPresetId &&
          chatttsPresetId !== 'random' &&
          chatttsPresetOptions.some((preset) => preset.id === chatttsPresetId) ? (
            <p className="panel__hint panel__hint--muted">
              {chatttsPresetOptions.find((preset) => preset.id === chatttsPresetId)?.notes ?? 'Preset speaker embedding applied to ChatTTS runs.'}
            </p>
          ) : (
            <p className="panel__hint panel__hint--muted">Random mode samples a new speaker for each synthesis.</p>
          )}
        </label>
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
