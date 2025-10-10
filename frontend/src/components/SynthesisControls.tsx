interface SynthesisControlsProps {
  language: string;
  languages: string[];
  onLanguageChange: (value: string) => void;
  speed: number;
  onSpeedChange: (value: number) => void;
  trimSilence: boolean;
  onTrimSilenceChange: (value: boolean) => void;
  autoPlay: boolean;
  onAutoPlayChange: (value: boolean) => void;
}

export function SynthesisControls({
  language,
  languages,
  onLanguageChange,
  speed,
  onSpeedChange,
  trimSilence,
  onTrimSilenceChange,
  autoPlay,
  onAutoPlayChange,
}: SynthesisControlsProps) {
  return (
    <section className="panel">
      <header className="panel__header">
        <h2 className="panel__title">Settings</h2>
      </header>
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

