import type { VoiceProfile } from '../types';

interface AnnouncerControlsProps {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  voices: VoiceProfile[];
  selectedVoice: string | null;
  onVoiceChange: (value: string | null) => void;
  template: string;
  onTemplateChange: (value: string) => void;
  gapSeconds: number;
  onGapChange: (value: number) => void;
}

const DEFAULT_TEMPLATE_HINT = 'Use {voice_label} or {voice} placeholders for per-voice inserts.';

export function AnnouncerControls({
  enabled,
  onEnabledChange,
  voices,
  selectedVoice,
  onVoiceChange,
  template,
  onTemplateChange,
  gapSeconds,
  onGapChange,
}: AnnouncerControlsProps) {
  const sortedVoices = [...voices].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <section className="panel">
      <header className="panel__header">
        <h2 className="panel__title">Announcer</h2>
      </header>
      <div className="toggle-list">
        <label className="toggle">
          <input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} />
          <span>Insert announcer line before each voice</span>
        </label>
      </div>
      {enabled ? (
        <>
          <div className="grid grid--two">
            <label className="field">
              <span className="field__label">Announcer voice</span>
              <select
                value={selectedVoice ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  onVoiceChange(value === '' ? null : value);
                }}
              >
                <option value="">Use audition voice</option>
                {sortedVoices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">
                Gap after announcer <span className="field__value">{gapSeconds.toFixed(2)}s</span>
              </span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={gapSeconds}
                onChange={(event) => onGapChange(parseFloat(event.target.value))}
              />
            </label>
          </div>
          <label className="field">
            <span className="field__label">Announcer template</span>
            <input
              type="text"
              value={template}
              onChange={(event) => onTemplateChange(event.target.value)}
              placeholder="Now auditioning {voice_label}"
            />
            <span className="panel__hint">{DEFAULT_TEMPLATE_HINT}</span>
          </label>
        </>
      ) : null}
    </section>
  );
}
