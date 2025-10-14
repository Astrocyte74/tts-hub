interface SettingsPopoverProps {
  open: boolean;
  onClose: () => void;
  speed: number;
  onSpeedChange: (value: number) => void;
  trimSilence: boolean;
  onTrimSilenceChange: (value: boolean) => void;
  autoPlay: boolean;
  onAutoPlayChange: (value: boolean) => void;
  hoverPreview: boolean;
  onHoverPreviewChange: (value: boolean) => void;
  autoOpenClips?: boolean;
  onAutoOpenClipsChange?: (value: boolean) => void;
}

export function SettingsPopover({
  open,
  onClose,
  speed,
  onSpeedChange,
  trimSilence,
  onTrimSilenceChange,
  autoPlay,
  onAutoPlayChange,
  hoverPreview,
  onHoverPreviewChange,
  autoOpenClips = true,
  onAutoOpenClipsChange,
}: SettingsPopoverProps) {
  if (!open) return null;
  return (
    <div className="popover" role="dialog" aria-label="Quick settings">
      <div className="popover__backdrop" onClick={onClose} aria-hidden></div>
      <div className="popover__panel">
        <header className="popover__header">
          <h3 className="popover__title">Quick settings</h3>
        </header>
        <div className="popover__content">
          <div className="popover__row">
            <label className="toggle">
              <input
                type="checkbox"
                checked={trimSilence}
                onChange={(e) => onTrimSilenceChange(e.target.checked)}
              />
              <span>Trim silence</span>
            </label>
          </div>
          <div className="popover__row">
            <label className="toggle">
              <input type="checkbox" checked={autoPlay} onChange={(e) => onAutoPlayChange(e.target.checked)} />
              <span>Autoplay new clips</span>
            </label>
          </div>
          <div className="popover__row">
            <label className="toggle">
              <input
                type="checkbox"
                checked={hoverPreview}
                onChange={(e) => onHoverPreviewChange(e.target.checked)}
              />
              <span>Auto preview on hover</span>
            </label>
          </div>
          <div className="popover__row">
            <label className="toggle">
              <input
                type="checkbox"
                checked={autoOpenClips}
                onChange={(e) => onAutoOpenClipsChange && onAutoOpenClipsChange(e.target.checked)}
              />
              <span>Auto open Clips on completion</span>
            </label>
          </div>
          <div className="popover__row">
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
                onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
              />
            </label>
          </div>
        </div>
        <footer className="popover__footer">
          <button className="popover__button" type="button" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
