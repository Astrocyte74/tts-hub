import type { SVGProps } from 'react';
import { WaveformPlayer } from './WaveformPlayer';
import type { SynthesisResult } from '../types';

interface AudioResultCardProps {
  item: SynthesisResult;
  autoPlay?: boolean;
  onRemove?: (id: string) => void;
  onSaveChattts?: (item: SynthesisResult) => void;
  isSavingChattts?: boolean;
  onSaveKokoroFavorite?: (item: SynthesisResult) => void;
  kokoroFavoriteSummary?: {
    label: string;
    count: number;
  };
}

export function AudioResultCard({
  item,
  autoPlay = false,
  onRemove,
  onSaveChattts,
  isSavingChattts = false,
  onSaveKokoroFavorite,
  kokoroFavoriteSummary,
}: AudioResultCardProps) {
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
  const engineId = (item.engine ?? '').toString().toLowerCase();
  const isChattts = (item.engine ?? 'chattts') === 'chattts' || engineId === 'chattts';
  const isKokoro = engineId === 'kokoro' || (!item.engine && !engineId);
  const isOpenvoice = engineId === 'openvoice';
  const openvoiceBadges: { label: string; variant: 'style' | 'language' }[] = [];
  let openvoicePreviewUrl: string | null = null;
  let openvoicePreviewSupportsInline = false;
  let openvoiceReferenceTitle: string | undefined;
  let openvoiceReferenceLabel: string | null = null;

  if (isChattts) {
    entries.push({ label: 'Speaker', value: speakerSnippet, title: hasSpeaker ? (meta.speaker as string) : undefined });
    entries.push({ label: 'Seed', value: seedValue !== undefined ? String(seedValue) : 'random' });
  } else if (isOpenvoice) {
    const referenceRaw = typeof meta.reference === 'string' ? (meta.reference as string) : undefined;
    const referenceName = typeof meta.reference_name === 'string' && (meta.reference_name as string).trim()
      ? (meta.reference_name as string)
      : referenceRaw
      ? normaliseReferenceName(referenceRaw)
      : '';
    openvoiceReferenceLabel = referenceName || null;
    openvoiceReferenceTitle = referenceRaw;
    openvoicePreviewUrl = buildOpenvoicePreviewUrl(meta as Record<string, unknown>);
    openvoicePreviewSupportsInline = Boolean(openvoicePreviewUrl && !openvoicePreviewUrl.startsWith("file://"));

    const styleLabel = typeof meta.style === 'string' && meta.style.trim() ? (meta.style as string).trim() : null;
    const languageLabel = typeof meta.language === 'string' && meta.language.trim()
      ? (meta.language as string).trim().toUpperCase()
      : null;
    if (styleLabel) {
      openvoiceBadges.push({ label: styleLabel, variant: 'style' });
    }
    if (languageLabel) {
      openvoiceBadges.push({ label: languageLabel, variant: 'language' });
    }
    if (openvoiceReferenceLabel) {
      entries.push({ label: 'Reference', value: openvoiceReferenceLabel, title: openvoiceReferenceTitle });
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

  const showChatttsSaveButton = isChattts && Boolean(onSaveChattts);
  const showKokoroSaveButton = isKokoro && Boolean(onSaveKokoroFavorite);
  const kokoroFavoriteMessage = kokoroFavoriteSummary
    ? kokoroFavoriteSummary.count > 1
      ? `Saved to favorites as “${kokoroFavoriteSummary.label}” (+${kokoroFavoriteSummary.count - 1} more).`
      : `Saved to favorites as “${kokoroFavoriteSummary.label}”.`
    : null;
  const kokoroMetadataAvailable = typeof item.voice === 'string' && item.voice.trim().length > 0;

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
      {isOpenvoice && openvoiceBadges.length ? (
        <div className="result-card__badges">
          {openvoiceBadges.map((badge) => (
            <span key={`${badge.variant}-${badge.label}`} className={`result-card__badge result-card__badge--${badge.variant}`}>
              {badge.label}
            </span>
          ))}
        </div>
      ) : null}
      {entries.length ? (
        <div className="result-card__meta">
          {entries.map((entry) => (
            <span key={entry.label} title={entry.title}>{entry.label}: {entry.value}</span>
          ))}
        </div>
      ) : null}
      {isOpenvoice && openvoicePreviewUrl ? (
        <div className="result-card__preview">
          {openvoicePreviewSupportsInline ? (
            <audio className="result-card__preview-audio" controls preload="none" src={openvoicePreviewUrl}>
              Your browser does not support inline playback.
            </audio>
          ) : null}
          <a className="result-card__preview-link" href={openvoicePreviewUrl} target="_blank" rel="noreferrer" title={openvoiceReferenceTitle}>
            <WaveformIcon className="result-card__waveform-icon" aria-hidden="true" />
            <span>Preview {openvoiceReferenceLabel ?? 'reference'}</span>
          </a>
        </div>
      ) : null}
      <WaveformPlayer src={item.audioUrl} autoPlay={autoPlay} />
      <p className="result-card__text">{item.text}</p>
      {showChatttsSaveButton ? (
        <button
          type="button"
          className="result-card__button result-card__button--primary"
          disabled={!hasSpeaker || isSavingChattts}
          onClick={() => onSaveChattts && onSaveChattts(item)}
        >
          {isSavingChattts ? 'Saving preset…' : 'Save as preset'}
        </button>
      ) : null}
      {showKokoroSaveButton ? (
        <button
          type="button"
          className="result-card__button result-card__button--primary"
          disabled={!kokoroMetadataAvailable}
          onClick={() => onSaveKokoroFavorite && onSaveKokoroFavorite(item)}
        >
          Save as favorite
        </button>
      ) : null}
      {kokoroFavoriteMessage ? <p className="result-card__notice">{kokoroFavoriteMessage}</p> : null}
    </article>
  );
}

function normaliseReferenceName(value: string): string {
  const normalised = value.replace(/\\\\/g, '/').replace(/\\/g, '/');
  const parts = normalised.split('/');
  return parts[parts.length - 1] || normalised;
}

function buildOpenvoicePreviewUrl(meta: Record<string, unknown>): string | null {
  const directUrl = typeof meta.reference_preview === 'string' && meta.reference_preview.trim()
    ? (meta.reference_preview as string)
    : typeof meta.reference_url === 'string' && meta.reference_url.trim()
    ? (meta.reference_url as string)
    : null;
  if (directUrl) {
    return directUrl;
  }
  const relativeValue =
    typeof meta.reference_relative === 'string' && meta.reference_relative.trim()
      ? (meta.reference_relative as string)
      : typeof meta.reference_rel === 'string' && meta.reference_rel.trim()
      ? (meta.reference_rel as string)
      : null;
  if (relativeValue) {
    return `/audio/openvoice/${encodeReferencePath(relativeValue)}`;
  }
  const reference = typeof meta.reference === 'string' ? meta.reference.trim() : '';
  if (!reference) {
    return null;
  }
  if (reference.startsWith('http://') || reference.startsWith('https://')) {
    return reference;
  }
  const normalised = reference.replace(/\\\\/g, '/').replace(/\\/g, '/');
  if (normalised.startsWith('openvoice/')) {
    const trimmed = normalised.replace(/^openvoice\//, '');
    return `/audio/openvoice/${encodeReferencePath(trimmed)}`;
  }
  return null;
}

function encodeReferencePath(value: string): string {
  return value
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function WaveformIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M3 13h2v6H3v-6zm4-8h2v14H7V5zm4 4h2v12h-2V9zm4-6h2v18h-2V3zm4 8h2v8h-2v-8z" />
    </svg>
  );
}
