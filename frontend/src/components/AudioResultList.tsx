import type { SynthesisResult } from '../types';
import { AudioResultCard } from './AudioResultCard';

interface AudioResultListProps {
  items: SynthesisResult[];
  autoPlay: boolean;
  onRemove: (id: string) => void;
  onSaveChattts?: (item: SynthesisResult) => void;
  savingChatttsId?: string | null;
  onSaveKokoroFavorite?: (item: SynthesisResult) => void;
  kokoroFavoritesByVoice?: Record<
    string,
    {
      label: string;
      count: number;
    }
  >;
}

export function AudioResultList({
  items,
  autoPlay,
  onRemove,
  onSaveChattts,
  savingChatttsId = null,
  onSaveKokoroFavorite,
  kokoroFavoritesByVoice = {},
}: AudioResultListProps) {
  if (!items.length) {
    return (
      <section className="panel">
        <header className="panel__header">
          <h2 className="panel__title">Results</h2>
        </header>
        <p className="panel__empty">Generate audio to see the clips here.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <header className="panel__header">
        <h2 className="panel__title">Results</h2>
      </header>
      <div className="result-grid">
        {items.map((item, index) => (
          <AudioResultCard
            key={item.id}
            item={item}
            autoPlay={autoPlay && index === 0}
            onRemove={onRemove}
            onSaveChattts={onSaveChattts}
            isSavingChattts={onSaveChattts && savingChatttsId === item.id && item.engine === 'chattts'}
            onSaveKokoroFavorite={onSaveKokoroFavorite}
            kokoroFavoriteSummary={item.voice ? kokoroFavoritesByVoice[item.voice] : undefined}
          />
        ))}
      </div>
    </section>
  );
}
