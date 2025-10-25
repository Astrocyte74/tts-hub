import { useEffect, useState } from 'react';
import type { SynthesisResult } from '../types';
import { AudioResultCard } from './AudioResultCard';

interface QueueItem {
  id: string;
  label: string;
  engine: string;
  status: 'pending' | 'rendering' | 'done' | 'error' | 'canceled';
  progress?: number; // 0..100
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

interface ResultsDrawerProps {
  open: boolean;
  onToggle: () => void;
  items: SynthesisResult[];
  queue: QueueItem[];
  autoPlay: boolean;
  onRemove: (id: string) => void;
  onCancelQueue?: (id: string) => void;
  onClearHistory?: () => void;
  onClearQueue?: () => void;
  onSaveChattts?: (item: SynthesisResult) => void;
  savingChatttsId?: string | null;
  onSaveKokoroFavorite?: (item: SynthesisResult) => void;
  kokoroFavoritesByVoice?: Record<string, { label: string; count: number }>;
  highlightId?: string | null;
}

export function ResultsDrawer({
  open,
  onToggle,
  items,
  queue,
  autoPlay,
  onRemove,
  onCancelQueue,
  onClearHistory,
  onClearQueue,
  onSaveChattts,
  savingChatttsId = null,
  onSaveKokoroFavorite,
  kokoroFavoritesByVoice = {},
  highlightId = null,
}: ResultsDrawerProps) {
  const activeCount = queue.filter((q) => q.status === 'pending' || q.status === 'rendering').length;
  const hasActiveQueue = activeCount > 0;
  const [activeTab, setActiveTab] = useState<'queue' | 'history'>(hasActiveQueue ? 'queue' : 'history');
  const clipCount = items.length;

  useEffect(() => {
    if (!open) return;
    if (hasActiveQueue) {
      setActiveTab('queue');
    } else if (clipCount) {
      setActiveTab('history');
    }
  }, [open, hasActiveQueue, clipCount]);

  const toggleLabel = open ? 'Close' : `Open (${clipCount})`;

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
            Queue {hasActiveQueue ? `(${activeCount})` : ''}
          </button>
          <button
            type="button"
            className={`tabs__tab ${activeTab === 'history' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            Clips ({clipCount})
          </button>
        </div>
        {activeTab === 'queue' ? (
          <div className="queue-list" role="list" aria-label="Render queue">
            {!hasActiveQueue ? (
              <div className="results-drawer__empty">No pending items.</div>
            ) : (
              <>
                {queue.filter((q) => q.status === 'pending' || q.status === 'rendering').map((q) => (
                  <div key={q.id} role="listitem" className={`queue-row queue-row--${q.status}`}>
                    <div className="queue-row__title">{q.label}</div>
                    <div className="queue-row__meta">{q.engine}</div>
                    <div className="queue-row__progress">
                      <div
                        className="progress"
                        role="progressbar"
                        aria-label="Queue progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.min(100, Math.max(0, q.progress ?? 0))}
                      >
                        <span style={{ width: `${Math.min(100, Math.max(0, q.progress ?? 0))}%` }} />
                      </div>
                    </div>
                    <div className="queue-row__actions">
                      {onCancelQueue && q.status === 'rendering' ? (
                        <button type="button" className="small-btn" onClick={() => onCancelQueue(q.id)} aria-label="Cancel">
                          Cancel
                        </button>
                      ) : (
                        <span className="queue-row__status">{q.status}</span>
                      )}
                    </div>
                  </div>
                ))}
                {onClearQueue ? (
                  <div className="queue-actions">
                    <button type="button" className="small-btn" onClick={onClearQueue} aria-label="Clear queue">
                      Clear queue
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <div className="results-drawer__list">
            {!clipCount ? (
              <div className="results-drawer__empty">Generate audio to see the clips here.</div>
            ) : (
              <>
                {items.map((item, index) => (
                  <AudioResultCard
                    key={item.id}
                    item={item}
                    autoPlay={autoPlay && index === 0}
                    highlighted={highlightId === item.id}
                    onRemove={onRemove}
                    onSaveChattts={onSaveChattts}
                    isSavingChattts={onSaveChattts && savingChatttsId === item.id && item.engine === 'chattts'}
                    onSaveKokoroFavorite={onSaveKokoroFavorite}
                    kokoroFavoriteSummary={item.voice ? kokoroFavoritesByVoice[item.voice] : undefined}
                  />
                ))}
                {onClearHistory ? (
                  <div className="queue-actions">
                    <button type="button" className="small-btn" onClick={onClearHistory} aria-label="Clear history">
                      Clear history
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
