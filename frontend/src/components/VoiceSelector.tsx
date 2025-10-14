import { useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { VoiceGroup, VoiceProfile } from '../types';

interface VoiceSelectorProps {
  engineLabel: string;
  engineAvailable: boolean;
  engineMessage?: string;
  isLoading?: boolean;
  voices: VoiceProfile[];
  groups?: VoiceGroup[];
  selected: string[];
  onToggle: (voiceId: string) => void;
  onClear: () => void;
  activeGroup?: string;
  onGroupChange?: (groupId: string) => void;
  voiceStyles?: Record<string, string>;
  styleOptions?: string[];
  onVoiceStyleChange?: (voiceId: string, style: string) => void;
  onOpenvoiceInstructions?: () => void;
  favorites?: string[];
  onToggleFavorite?: (voiceId: string) => void;
  onGeneratePreview?: (voiceId: string) => void;
  previewBusyIds?: string[];
}

interface GroupedVoices {
  id: string;
  label: string;
  flag?: string;
  voices: VoiceProfile[];
  totalCount?: number;
}

function groupVoicesByLocale(voices: VoiceProfile[]): GroupedVoices[] {
  const groups = new Map<string, VoiceProfile[]>();

  voices.forEach((voice) => {
    const key = voice.locale ?? 'unknown';
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(voice);
  });

  return Array.from(groups.entries())
    .map(([locale, voiceList]) => ({
      id: locale,
      label: locale === 'unknown' ? 'Other' : locale,
      voices: voiceList.sort((a, b) => a.label.localeCompare(b.label)),
      totalCount: voiceList.length,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildDisplayGroups(
  voices: VoiceProfile[],
  providedGroups: VoiceGroup[] | undefined,
  filter: Set<string>,
  activeGroup: string,
): GroupedVoices[] {
  if (providedGroups?.length) {
    const voiceMap = new Map(voices.map((voice) => [voice.id, voice]));
    const groups: GroupedVoices[] = [];
    providedGroups.forEach((group) => {
      if (activeGroup !== 'all' && group.id !== activeGroup) {
        return;
      }
      const items: VoiceProfile[] = [];
      group.voices.forEach((voiceId) => {
        const voice = voiceMap.get(voiceId);
        if (voice && filter.has(voice.id)) {
          items.push(voice);
        }
      });
      if (items.length) {
        groups.push({
          id: group.id,
          label: group.label,
          flag: group.flag,
          voices: items.sort((a, b) => a.label.localeCompare(b.label)),
          totalCount: group.count,
        });
      }
    });
    if (groups.length) {
      return groups;
    }
  }

  const filteredVoices = voices.filter((voice) => filter.has(voice.id));
  return groupVoicesByLocale(filteredVoices);
}

export function VoiceSelector({
  engineLabel,
  engineAvailable,
  engineMessage,
  isLoading = false,
  voices,
  groups,
  selected,
  onToggle,
  onClear,
  activeGroup = 'all',
  onGroupChange,
  voiceStyles,
  styleOptions,
  onVoiceStyleChange,
  onOpenvoiceInstructions,
  favorites = [],
  onToggleFavorite,
  onGeneratePreview,
  previewBusyIds = [],
}: VoiceSelectorProps) {
  const [query, setQuery] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
  const disabled = !engineAvailable || isLoading;
  const availableStyleChoices = useMemo(() => {
    if (!styleOptions || !styleOptions.length) {
      return null;
    }
    const unique = Array.from(new Set(['default', ...styleOptions]));
    return unique;
  }, [styleOptions]);

  const voicesAfterGroup = useMemo(() => {
    if (!groups?.length || activeGroup === 'all') {
      return voices;
    }
    const match = groups.find((group) => group.id === activeGroup);
    if (!match) {
      return voices;
    }
    const allowed = new Set(match.voices);
    return voices.filter((voice) => allowed.has(voice.id));
  }, [activeGroup, groups, voices]);

  const filteredVoices = useMemo(() => {
    if (!query.trim()) {
      return voicesAfterGroup;
    }
    const lower = query.toLowerCase();
    return voicesAfterGroup.filter((voice) => {
      return (
        voice.id.toLowerCase().includes(lower) ||
        voice.label.toLowerCase().includes(lower) ||
        (voice.locale && voice.locale.toLowerCase().includes(lower)) ||
        voice.tags.some((tag) => tag.toLowerCase().includes(lower))
      );
    });
  }, [query, voicesAfterGroup]);

  const filteredIds = useMemo(() => new Set(filteredVoices.map((voice) => voice.id)), [filteredVoices]);
  const displayGroups = useMemo(
    () => buildDisplayGroups(voices, groups, filteredIds, activeGroup),
    [voices, groups, filteredIds, activeGroup],
  );

  // Build facet counts from the current group-restricted, search-filtered list
  const facetSource = useMemo(() => Array.from(filteredIds).map((id) => voices.find((v) => v.id === id)!).filter(Boolean), [filteredIds, voices]);
  const localeCounts = useMemo(() => {
    const map = new Map<string, number>();
    facetSource.forEach((v) => {
      const key = v.locale ?? 'unknown';
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return Array.from(map.entries()).map(([value, count]) => ({ value, count }));
  }, [facetSource]);
  const genderCounts = useMemo(() => {
    const map = new Map<string, number>();
    facetSource.forEach((v) => {
      const key = v.gender ?? 'unknown';
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return Array.from(map.entries()).map(([value, count]) => ({ value, count }));
  }, [facetSource]);
  const tagCounts = useMemo(() => {
    const map = new Map<string, number>();
    facetSource.forEach((v) => v.tags.forEach((t) => map.set(t, (map.get(t) ?? 0) + 1)));
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([value, count]) => ({ value, count }));
  }, [facetSource]);

  const [activeLocales, setActiveLocales] = useState<string[]>([]);
  const [activeGenders, setActiveGenders] = useState<string[]>([]);
  const [activeTags, setActiveTags] = useState<string[]>([]);

  const toggleValue = (list: string[], setList: (next: string[]) => void, value: string) => {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const passesFacets = (voice: VoiceProfile) => {
    if (activeLocales.length && !activeLocales.includes(voice.locale ?? 'unknown')) return false;
    if (activeGenders.length && !activeGenders.includes(voice.gender ?? 'unknown')) return false;
    if (activeTags.length && !activeTags.some((t) => voice.tags.includes(t))) return false;
    return true;
  };

  const filteredForFacets = useMemo(() => {
    if (!activeLocales.length && !activeGenders.length && !activeTags.length) return filteredVoices;
    return filteredVoices.filter(passesFacets);
  }, [filteredVoices, activeLocales, activeGenders, activeTags]);

  // Hover preview (best-effort) — attempts to find a preview URL in raw data
  const toAbsolute = (url: string): string => {
    if (!url) return url;
    if (/^https?:\/\//i.test(url)) return url;
    return API_BASE ? `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}` : url;
  };

  const findPreviewUrl = (voice: VoiceProfile): string | null => {
    const candidates = ['sample_url','sample','preview_url','preview','audio_url','audio','demo_url','demo'];
    const tryObject = (obj: unknown): string | null => {
      if (!obj || typeof obj !== 'object') return null;
      const rec = obj as Record<string, unknown>;
      for (const key of candidates) {
        const v = typeof rec[key] === 'string' ? String(rec[key]) : '';
        if (v) {
          const normalized = v.startsWith('/audio/') || v.startsWith('http') ? v : `/audio/${v}`;
          return toAbsolute(normalized);
        }
      }
      return null;
    };
    // 1) raw at top-level (e.g., openvoice payloads)
    const raw = voice.raw as Record<string, unknown>;
    const direct = tryObject(raw);
    if (direct) return direct;
    // 2) nested raw field (e.g., kokoro server attaches preview under raw.preview_url)
    const nested = raw && typeof raw['raw'] === 'object' ? (raw['raw'] as Record<string, unknown>) : null;
    const nestedHit = tryObject(nested);
    if (nestedHit) return nestedHit;
    return null;
  };

  const playPreview = (voice: VoiceProfile) => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    const url = findPreviewUrl(voice);
    if (!url) return;
    const audio = audioRef.current;
    audio.pause();
    audio.src = url;
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  };
  const stopPreview = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
    }
  };

  const handleGroupToggle = (groupId: string) => {
    if (!onGroupChange) {
      return;
    }
    if (groupId === 'all') {
      onGroupChange('all');
    } else if (activeGroup === groupId) {
      onGroupChange('all');
    } else {
      onGroupChange(groupId);
    }
  };

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const favoritesInScope = useMemo(
    () => filteredForFacets.filter((v) => favoriteSet.has(v.id)),
    [filteredForFacets, favoriteSet],
  );

  const groupsToRender = useMemo(() => buildDisplayGroups(filteredForFacets, groups, new Set(filteredForFacets.map(v=>v.id)), activeGroup), [filteredForFacets, groups, activeGroup]);

  return (
    <section className="panel">
      <header className="panel__header">
        <div>
          <h2 className="panel__title">Voices</h2>
          <p className="panel__subtitle">
            {engineLabel} · {voices.length} available
          </p>
        </div>
        <button className="panel__button" type="button" onClick={onClear}>
          Clear
        </button>
      </header>
      {engineMessage ? <p className="panel__hint panel__hint--muted">{engineMessage}</p> : null}
      {engineLabel.toLowerCase().includes('openvoice') && onOpenvoiceInstructions ? (
        <p className="panel__hint panel__hint--muted">
          Need a new voice?{' '}
          <button type="button" className="link-button" onClick={onOpenvoiceInstructions}>
            Learn how to add custom references.
          </button>
        </p>
      ) : null}
      {!engineAvailable ? (
        <p className="panel__hint panel__hint--warning">This engine is not ready yet. Configure it or choose another engine.</p>
      ) : null}
      <div className="panel__search">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search voices, locales, tags..."
          className="panel__search-input"
          aria-label="Search voices"
          disabled={disabled}
        />
      </div>
      <div className="facet-chips" role="group" aria-label="Voice filters">
        <div className="facet-row">
          <span className="facet-label">Language</span>
          {localeCounts.map(({ value, count }) => (
            <button
              key={`loc-${value}`}
              type="button"
              className={clsx('facet-chip', { 'facet-chip--active': activeLocales.includes(value) })}
              onClick={() => toggleValue(activeLocales, setActiveLocales, value)}
            >
              {value} <span className="facet-count">{count}</span>
            </button>
          ))}
        </div>
        <div className="facet-row">
          <span className="facet-label">Gender</span>
          {genderCounts.map(({ value, count }) => (
            <button
              key={`gen-${value}`}
              type="button"
              className={clsx('facet-chip', { 'facet-chip--active': activeGenders.includes(value) })}
              onClick={() => toggleValue(activeGenders, setActiveGenders, value)}
            >
              {value} <span className="facet-count">{count}</span>
            </button>
          ))}
        </div>
        <div className="facet-row facet-row--wrap">
          <span className="facet-label">Style</span>
          {tagCounts.map(({ value, count }) => (
            <button
              key={`tag-${value}`}
              type="button"
              className={clsx('facet-chip', { 'facet-chip--active': activeTags.includes(value) })}
              onClick={() => toggleValue(activeTags, setActiveTags, value)}
            >
              {value} <span className="facet-count">{count}</span>
            </button>
          ))}
          {(activeLocales.length || activeGenders.length || activeTags.length) ? (
            <button type="button" className="facet-chip facet-chip--ghost" onClick={() => { setActiveLocales([]); setActiveGenders([]); setActiveTags([]); }}>Clear filters</button>
          ) : null}
        </div>
      </div>
      <div className="voice-grid">
        {isLoading ? <p className="panel__empty">Loading voices…</p> : null}
        {!isLoading && !engineAvailable ? (
          <p className="panel__empty">Voice data is unavailable for this engine.</p>
        ) : null}
        {!isLoading && engineAvailable && favoritesInScope.length ? (
          <div className="voice-grid__group">
            <p className="voice-grid__group-title">Favorites</p>
            <div className="voice-grid__items">
              {favoritesInScope.map((voice) => {
                const isSelected = selected.includes(voice.id);
                const isFav = favoriteSet.has(voice.id);
                const hasPreview = Boolean(findPreviewUrl(voice));
                return (
                  <div key={`fav-${voice.id}`} className={clsx('voice-card', { 'voice-card--selected': isSelected, 'voice-card--disabled': disabled })}>
                    <button
                      type="button"
                      className="voice-card__toggle"
                      onMouseEnter={() => playPreview(voice)}
                      onMouseLeave={stopPreview}
                      onFocus={() => playPreview(voice)}
                      onBlur={stopPreview}
                      onClick={() => onToggle(voice.id)}
                      disabled={disabled}
                    >
                      <span className="voice-card__label">{voice.label}</span>
                      <span className="voice-card__meta">
                        {voice.accent ? (
                          <span className="voice-card__meta-pill" title={voice.accent.label}>
                            <span aria-hidden="true">{voice.accent.flag}</span>
                            <span className="voice-card__meta-pill-text">{voice.accent.label}</span>
                          </span>
                        ) : null}
                        {voice.locale ? <span>{voice.locale}</span> : null}
                        {voice.gender ? <span>{voice.gender}</span> : null}
                      </span>
                    </button>
                    {hasPreview ? (
                      <button type="button" className="chip-button" aria-label="Play preview" onClick={() => playPreview(voice)}>
                        Preview
                      </button>
                    ) : null}
                    {(!findPreviewUrl(voice) && onGeneratePreview) ? (
                      <button
                        type="button"
                        className="chip-button"
                        disabled={previewBusyIds.includes(voice.id)}
                        onClick={() => onGeneratePreview(voice.id)}
                      >
                        {previewBusyIds.includes(voice.id) ? 'Generating…' : 'Generate preview'}
                      </button>
                    ) : null}
                    {onToggleFavorite ? (
                      <button type="button" className={clsx('fav-btn', { 'is-active': isFav })} aria-label={isFav ? 'Unfavorite' : 'Favorite'} aria-pressed={isFav} onClick={() => onToggleFavorite(voice.id)}>
                        {isFav ? '★' : '☆'}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {!isLoading && engineAvailable
          ? groupsToRender.map((group) => (
              <div key={group.id} className="voice-grid__group">
                <p className="voice-grid__group-title">
                  {group.flag ? (
                    <span className="voice-grid__group-flag" role="img" aria-hidden="true">
                      {group.flag}
                    </span>
                  ) : null}
                  <span>{group.label}</span>
                  <span className="voice-grid__group-count">
                    {group.totalCount && group.totalCount !== group.voices.length
                      ? `(${group.voices.length}/${group.totalCount})`
                      : `(${group.voices.length})`}
                  </span>
                </p>
                <div className="voice-grid__items">
                  {group.voices.map((voice) => {
                    const isSelected = selected.includes(voice.id);
                    const isFav = favoriteSet.has(voice.id);
                    const hasPreview = Boolean(findPreviewUrl(voice));
                    const voiceStyle = voiceStyles?.[voice.id];
                    const canEditStyle = !!availableStyleChoices?.length && typeof onVoiceStyleChange === 'function';
                    return (
                      <div
                        key={voice.id}
                        className={clsx('voice-card', {
                          'voice-card--selected': isSelected,
                          'voice-card--disabled': disabled,
                        })}
                      >
                        <button
                          type="button"
                          className="voice-card__toggle"
                          onMouseEnter={() => playPreview(voice)}
                          onMouseLeave={stopPreview}
                          onFocus={() => playPreview(voice)}
                          onBlur={stopPreview}
                          onClick={() => onToggle(voice.id)}
                          disabled={disabled}
                        >
                          <span className="voice-card__label">{voice.label}</span>
                          <span className="voice-card__meta">
                            {voice.accent ? (
                              <span className="voice-card__meta-pill" title={voice.accent.label}>
                                <span aria-hidden="true">{voice.accent.flag}</span>
                                <span className="voice-card__meta-pill-text">{voice.accent.label}</span>
                              </span>
                            ) : null}
                            {voice.locale ? <span>{voice.locale}</span> : null}
                            {voice.gender ? <span>{voice.gender}</span> : null}
                          </span>
                          {voice.tags.length ? (
                            <span className="voice-card__tags">
                              {voice.tags.map((tag) => (
                                <span key={tag}>{tag}</span>
                              ))}
                            </span>
                          ) : null}
                        </button>
                        {hasPreview ? (
                          <button type="button" className="chip-button" aria-label="Play preview" onClick={() => playPreview(voice)}>
                            Preview
                          </button>
                        ) : null}
                        {(!findPreviewUrl(voice) && onGeneratePreview) ? (
                          <button
                            type="button"
                            className="chip-button"
                            disabled={previewBusyIds.includes(voice.id)}
                            onClick={() => onGeneratePreview(voice.id)}
                          >
                            {previewBusyIds.includes(voice.id) ? 'Generating…' : 'Generate preview'}
                          </button>
                        ) : null}
                        {onToggleFavorite ? (
                          <button type="button" className={clsx('fav-btn', { 'is-active': isFav })} aria-label={isFav ? 'Unfavorite' : 'Favorite'} aria-pressed={isFav} onClick={() => onToggleFavorite(voice.id)}>
                            {isFav ? '★' : '☆'}
                          </button>
                        ) : null}
                        {canEditStyle ? (
                          <label className="voice-card__style-control">
                            <span>Style</span>
                            <select
                              value={voiceStyle ?? availableStyleChoices![0] ?? 'default'}
                              onChange={(event) => onVoiceStyleChange(voice.id, event.target.value)}
                              disabled={disabled}
                            >
                              {availableStyleChoices!.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : voiceStyle ? (
                          <span className="voice-card__style">Style: {voiceStyle}</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          : null}
        {!isLoading && engineAvailable && displayGroups.length === 0 ? <p className="panel__empty">No voices match the current search.</p> : null}
      </div>
      {engineAvailable && groups?.length ? (
        <div className="voice-filter-chips" role="group" aria-label="Filter voices by group">
          <button
            type="button"
            className={clsx('voice-filter-chip', { 'voice-filter-chip--active': activeGroup === 'all' })}
            onClick={() => handleGroupToggle('all')}
          >
            <span className="voice-filter-chip__label">All</span>
            <span className="voice-filter-chip__count">{voices.length}</span>
          </button>
          {groups.map((group) => (
            <button
              type="button"
              key={group.id}
              className={clsx('voice-filter-chip', { 'voice-filter-chip--active': activeGroup === group.id })}
              onClick={() => handleGroupToggle(group.id)}
            >
              {group.flag ? (
                <span className="voice-filter-chip__flag" role="img" aria-hidden="true">
                  {group.flag}
                </span>
              ) : null}
              <span className="voice-filter-chip__label">{group.label}</span>
              <span className="voice-filter-chip__count">{group.count}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
