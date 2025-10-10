import type { SynthesisResult } from '../types';
import { AudioResultCard } from './AudioResultCard';

interface AudioResultListProps {
  items: SynthesisResult[];
  autoPlay: boolean;
  onRemove: (id: string) => void;
}

export function AudioResultList({ items, autoPlay, onRemove }: AudioResultListProps) {
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
          <AudioResultCard key={item.id} item={item} autoPlay={autoPlay && index === 0} onRemove={onRemove} />
        ))}
      </div>
    </section>
  );
}
