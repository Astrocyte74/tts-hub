import type { SynthesisResult } from '../types';
import { AudioResultCard } from './AudioResultCard';

interface ResultsDrawerProps {
  open: boolean;
  onToggle: () => void;
  items: SynthesisResult[];
  autoPlay: boolean;
  onRemove: (id: string) => void;
  onSaveChattts?: (item: SynthesisResult) => void;
  savingChatttsId?: string | null;
  onSaveKokoroFavorite?: (item: SynthesisResult) => void;
  kokoroFavoritesByVoice?: Record<string, { label: string; count: number }>;
}

export function ResultsDrawer({
  open,
  onToggle,
  items,
  autoPlay,
  onRemove,
  onSaveChattts,
  savingChatttsId = null,
  onSaveKokoroFavorite,
  kokoroFavoritesByVoice = {},
}: ResultsDrawerProps) {
  return (
    <div className={`results-drawer ${open ? 'results-drawer--open' : ''}`} aria-live="polite">
      <button
        type="button"
        className="results-drawer__toggle"
        aria-expanded={open}
        aria-controls="results-drawer-panel"
        onClick={onToggle}
      >
        {open ? 'Close Results' : `Open Results (${items.length})`}
      </button>
      <div id="results-drawer-panel" className="results-drawer__panel">
        {!items.length ? (
          <div className="results-drawer__empty">Generate audio to see the clips here.</div>
        ) : (
          <div className="results-drawer__list">
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
              />)
            )}
          </div>
        )}
      </div>
    </div>
  );
}

