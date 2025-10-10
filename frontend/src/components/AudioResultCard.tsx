import { WaveformPlayer } from './WaveformPlayer';
import type { SynthesisResult } from '../types';

interface AudioResultCardProps {
  item: SynthesisResult;
  autoPlay?: boolean;
  onRemove?: (id: string) => void;
}

export function AudioResultCard({ item, autoPlay = false, onRemove }: AudioResultCardProps) {
  const createdLabel = new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <article className="result-card">
      <header className="result-card__header">
        <div>
          <h3 className="result-card__title">{item.voice}</h3>
          <p className="result-card__subtitle">{createdLabel}</p>
        </div>
        <div className="result-card__actions">
          <a className="result-card__button" href={item.audioUrl} download>
            Download
          </a>
          {onRemove ? (
            <button className="result-card__button result-card__button--ghost" type="button" onClick={() => onRemove(item.id)}>
              Remove
            </button>
          ) : null}
        </div>
      </header>
      <WaveformPlayer src={item.audioUrl} autoPlay={autoPlay} />
      <p className="result-card__text">{item.text}</p>
    </article>
  );
}

