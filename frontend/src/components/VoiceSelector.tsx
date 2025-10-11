import { useMemo, useState } from 'react';
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
}: VoiceSelectorProps) {
  const [query, setQuery] = useState('');
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
      <div className="voice-grid">
        {isLoading ? <p className="panel__empty">Loading voices…</p> : null}
        {!isLoading && !engineAvailable ? (
          <p className="panel__empty">Voice data is unavailable for this engine.</p>
        ) : null}
        {!isLoading && engineAvailable
          ? displayGroups.map((group) => (
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
