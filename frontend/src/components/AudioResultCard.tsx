import { WaveformPlayer } from './WaveformPlayer';
import type { SynthesisResult } from '../types';

interface AudioResultCardProps {
  item: SynthesisResult;
  autoPlay?: boolean;
  onRemove?: (id: string) => void;
  onSaveChattts?: (item: SynthesisResult) => void;
  isSavingChattts?: boolean;
}

export function AudioResultCard({ item, autoPlay = false, onRemove, onSaveChattts, isSavingChattts = false }: AudioResultCardProps) {
  const createdLabel = new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const engineLabel = item.engine ? item.engine.toUpperCase() : 'ENGINE';
  const meta = (item.meta ?? {}) as Record<string, unknown>;
  const entries: { label: string; value: string; title?: string }[] = [];
  const hasSpeaker = typeof meta.speaker === 'string' && meta.speaker.trim().length > 0;
  const speakerSnippet = hasSpeaker
    ? meta.speaker && (meta.speaker as string).length > 16
      ? `${(meta.speaker as string).slice(0, 8)}…${(meta.speaker as string).slice(-8)}`
      : (meta.speaker as string)
    : '—';
  const seedValue = typeof meta.seed === 'number' ? (meta.seed as number) : undefined;

  if ((item.engine ?? 'chattts') === 'chattts') {
    entries.push({ label: 'Speaker', value: speakerSnippet, title: hasSpeaker ? (meta.speaker as string) : undefined });
    entries.push({ label: 'Seed', value: seedValue !== undefined ? String(seedValue) : 'random' });
  } else if ((item.engine ?? '').toLowerCase() === 'openvoice') {
    const referenceName = typeof meta.reference_name === 'string'
      ? (meta.reference_name as string)
      : typeof meta.reference === 'string'
      ? (meta.reference as string).split(/[\\/]/).pop() ?? ''
      : '';
    if (referenceName) {
      entries.push({ label: 'Reference', value: referenceName, title: typeof meta.reference === 'string' ? (meta.reference as string) : undefined });
    }
    if (typeof meta.style === 'string' && meta.style.trim()) {
      entries.push({ label: 'Style', value: meta.style as string });
    }
    if (typeof meta.language === 'string' && meta.language.trim()) {
      entries.push({ label: 'Language', value: (meta.language as string).toUpperCase() });
    }
    if (typeof meta.watermark === 'string' && meta.watermark.trim()) {
      entries.push({ label: 'Watermark', value: meta.watermark as string });
    }
  } else {
    const accent = (meta.accent ?? null) as { id?: string; label?: string; flag?: string } | null;
    const accentLabel = accent?.label ? `${accent.flag ?? ''} ${accent.label}`.trim() : null;
    if (accentLabel) {
      entries.push({ label: 'Accent', value: accentLabel });
    }
    if (typeof meta.locale === 'string' && meta.locale.trim()) {
      entries.push({ label: 'Locale', value: meta.locale as string });
    }
    if (typeof meta.language === 'string' && meta.language.trim()) {
      entries.push({ label: 'Language', value: (meta.language as string).toLowerCase() });
    }
    if (typeof meta.speed === 'number' && Number.isFinite(meta.speed)) {
      entries.push({ label: 'Speed', value: `${Number(meta.speed).toFixed(2)}×` });
    }
    if (typeof meta.trim_silence === 'boolean') {
      entries.push({ label: 'Trim silence', value: meta.trim_silence ? 'On' : 'Off' });
    }
  }

  const showSaveButton = item.engine === 'chattts' && Boolean(onSaveChattts);

  return (
    <article className="result-card">
      <header className="result-card__header">
        <div>
          <h3 className="result-card__title">{item.voice}</h3>
          <p className="result-card__subtitle">{createdLabel}</p>
        </div>
        <span className="result-card__engine">{engineLabel}</span>
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
      {entries.length ? (
        <div className="result-card__meta">
          {entries.map((entry) => (
            <span key={entry.label} title={entry.title}>{entry.label}: {entry.value}</span>
          ))}
        </div>
      ) : null}
      <WaveformPlayer src={item.audioUrl} autoPlay={autoPlay} />
      <p className="result-card__text">{item.text}</p>
      {showSaveButton ? (
        <button
          type="button"
          className="result-card__button result-card__button--primary"
          disabled={!hasSpeaker || isSavingChattts}
          onClick={() => onSaveChattts && onSaveChattts(item)}
        >
          {isSavingChattts ? 'Saving preset…' : 'Save as preset'}
        </button>
      ) : null}
    </article>
  );
}
