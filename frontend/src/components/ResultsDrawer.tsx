import { useState } from 'react';
import type { SynthesisResult } from '../types';
import { AudioResultCard } from './AudioResultCard';

interface QueueItem {
  id: string;
  label: string;
  engine: string;
  status: 'pending' | 'rendering' | 'done' | 'error';
  error?: string;
}

interface ResultsDrawerProps {
  open: boolean;
  onToggle: () => void;
  items: SynthesisResult[];
  queue: QueueItem[];
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
  queue,
  autoPlay,
  onRemove,
  onSaveChattts,
  savingChatttsId = null,
  onSaveKokoroFavorite,
  kokoroFavoritesByVoice = {},
}: ResultsDrawerProps) {
  const hasQueue = queue.length > 0;
  const [activeTab, setActiveTab] = useState<'queue' | 'history'>(hasQueue ? 'queue' : 'history');

  const toggleLabel = open ? 'Close' : `Open (${items.length})`;

  return (
    <div className={`results-drawer ${open ? 'results-drawer--open' : ''}`} aria-live="polite">
      <button
        type="button"
        className="results-drawer__toggle"
        aria-expanded={open}
        aria-controls="results-drawer-panel"
        onClick={onToggle}
      >
        {toggleLabel} Results
      </button>
      <div id="results-drawer-panel" className="results-drawer__panel">
        <div className="tabs">
          <button
            type="button"
            className={`tabs__tab ${activeTab === 'queue' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('queue')}
          >
            Queue {hasQueue ? `(${queue.length})` : ''}
          </button>
          <button
            type="button"
            className={`tabs__tab ${activeTab === 'history' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            History ({items.length})
          </button>
        </div>
        {activeTab === 'queue' ? (
          <div className="queue-list">
            {!queue.length ? (
              <div className="results-drawer__empty">No pending items.</div>
            ) : (
              queue.map((q) => (
                <div key={q.id} className={`queue-row queue-row--${q.status}`}>
                  <div className="queue-row__title">{q.label}</div>
                  <div className="queue-row__meta">{q.engine}</div>
                  <div className="queue-row__status">{q.status}</div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="results-drawer__list">
            {!items.length ? (
              <div className="results-drawer__empty">Generate audio to see the clips here.</div>
            ) : (
              items.map((item, index) => (
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
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
