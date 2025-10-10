import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import './App.css';
import { VoiceSelector } from './components/VoiceSelector';
import { TextWorkbench } from './components/TextWorkbench';
import { SynthesisControls } from './components/SynthesisControls';
import { AnnouncerControls } from './components/AnnouncerControls';
import { SynthesisActions } from './components/SynthesisActions';
import { AudioResultList } from './components/AudioResultList';
import { useLocalStorage } from './hooks/useLocalStorage';
import {
  createAudition,
  fetchMeta,
  fetchRandomText,
  fetchVoices,
  fetchVoiceGroups,
  synthesiseClip,
} from './api/client';
import type { RandomTextResult, SynthesisResult, VoiceProfile } from './types';

const FALLBACK_CATEGORIES = ['any', 'narration', 'promo', 'dialogue', 'news', 'story', 'whimsy'];
const DEFAULT_LANGUAGE = 'en-us';
const DEFAULT_TEXT = 'Welcome to the Kokoro Playground SPA. Try synthesising this line!';
const DEFAULT_ANNOUNCER_TEMPLATE = 'Now auditioning {voice_label}';

function normaliseLanguage(language: string | null | undefined): string {
  if (!language) {
    return DEFAULT_LANGUAGE;
  }
  return language.toLowerCase();
}

function buildLanguageOptions(voices: VoiceProfile[]): string[] {
  const locales = new Set<string>();
  voices.forEach((voice) => {
    if (voice.locale) {
      locales.add(normaliseLanguage(voice.locale));
    }
  });
  if (!locales.size) {
    locales.add(DEFAULT_LANGUAGE);
  }
  return Array.from(locales).sort((a, b) => a.localeCompare(b));
}

function App() {
  const [text, setText] = useLocalStorage('kokoro:text', DEFAULT_TEXT);
  const [selectedVoices, setSelectedVoices] = useLocalStorage<string[]>('kokoro:selectedVoices', []);
  const [language, setLanguage] = useLocalStorage('kokoro:language', DEFAULT_LANGUAGE);
  const [speed, setSpeed] = useLocalStorage('kokoro:speed', 1);
  const [trimSilence, setTrimSilence] = useLocalStorage('kokoro:trimSilence', true);
  const [autoPlay, setAutoPlay] = useLocalStorage('kokoro:autoPlay', true);
  const [announcerEnabled, setAnnouncerEnabled] = useLocalStorage('kokoro:announcerEnabled', false);
  const [announcerVoice, setAnnouncerVoice] = useLocalStorage<string | null>('kokoro:announcerVoice', null);
  const [announcerTemplate, setAnnouncerTemplate] = useLocalStorage('kokoro:announcerTemplate', DEFAULT_ANNOUNCER_TEMPLATE);
  const [announcerGap, setAnnouncerGap] = useLocalStorage('kokoro:announcerGap', 0.5);
  const [voiceGroupFilter, setVoiceGroupFilter] = useLocalStorage('kokoro:voiceGroupFilter', 'all');
  const [results, setResults] = useState<SynthesisResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [extraCategories, setExtraCategories] = useState<string[]>([]);

  const metaQuery = useQuery({ queryKey: ['meta'], queryFn: fetchMeta, staleTime: 5 * 60 * 1000 });
  const voicesQuery = useQuery({ queryKey: ['voices'], queryFn: fetchVoices, staleTime: 5 * 60 * 1000 });
  const voiceGroupsQuery = useQuery({ queryKey: ['voices-grouped'], queryFn: fetchVoiceGroups, staleTime: 5 * 60 * 1000 });

  const voices = useMemo(() => voicesQuery.data ?? [], [voicesQuery.data]);
  const voiceGroupData = useMemo(() => voiceGroupsQuery.data ?? [], [voiceGroupsQuery.data]);
  const accentGroups = useMemo(() => {
    if (voiceGroupData.length) {
      return voiceGroupData;
    }
    return metaQuery.data?.accent_groups ?? [];
  }, [voiceGroupData, metaQuery.data?.accent_groups]);
  const voiceCount = voices.length;
  const ollamaAvailable = metaQuery.data?.ollama_available ?? false;
  const backendReady = metaQuery.data ? metaQuery.data.has_model && metaQuery.data.has_voices : true;

  useEffect(() => {
    if (!accentGroups.length) {
      return;
    }
    const validIds = new Set(accentGroups.map((group) => group.id));
    if (voiceGroupFilter !== 'all' && !validIds.has(voiceGroupFilter)) {
      setVoiceGroupFilter('all');
    }
  }, [accentGroups, voiceGroupFilter, setVoiceGroupFilter]);

  const categories = useMemo(() => {
    const combined = new Set<string>(['any']);
    (metaQuery.data?.random_categories ?? []).forEach((category) => combined.add(category));
    extraCategories.forEach((category) => combined.add(category));
    if (combined.size <= 1) {
      FALLBACK_CATEGORIES.forEach((category) => combined.add(category));
    }
    return Array.from(combined);
  }, [metaQuery.data?.random_categories, extraCategories]);

  const [randomCategory, setRandomCategory] = useLocalStorage('kokoro:randomCategory', categories[0] ?? 'any');

  useEffect(() => {
    if (!categories.length) {
      return;
    }
    if (!categories.includes(randomCategory)) {
      setRandomCategory(categories[0]);
    }
  }, [categories, randomCategory, setRandomCategory]);

  useEffect(() => {
    if (!voices.length || !selectedVoices.length) {
      return;
    }
    const valid = selectedVoices.filter((voiceId) => voices.some((voice) => voice.id === voiceId));
    if (valid.length !== selectedVoices.length) {
      setSelectedVoices(valid);
    }
  }, [voices, selectedVoices, setSelectedVoices]);

  useEffect(() => {
    if (announcerVoice && !voices.some((voice) => voice.id === announcerVoice)) {
      setAnnouncerVoice(null);
    }
  }, [announcerVoice, voices, setAnnouncerVoice]);

  const availableLanguages = useMemo(() => buildLanguageOptions(voices), [voices]);

  useEffect(() => {
    if (!availableLanguages.includes(language)) {
      setLanguage(availableLanguages[0] ?? DEFAULT_LANGUAGE);
    }
  }, [availableLanguages, language, setLanguage]);

  const randomTextMutation = useMutation<RandomTextResult, unknown, string | undefined>({
    mutationFn: (category: string | undefined) => fetchRandomText(category),
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to load random text.');
    },
  });

  const auditionMutation = useMutation({
    mutationFn: createAudition,
    onSuccess: (result) => {
      setResults((prev) => [result, ...prev]);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Audition request failed.');
    },
  });

  const synthMutation = useMutation({
    mutationFn: synthesiseClip,
    onSuccess: (result) => {
      setResults((prev) => [result, ...prev]);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Synthesis request failed.');
    },
  });

  const handleRandomResult = (generated: RandomTextResult) => {
    setExtraCategories((prev) => {
      const merged = new Set(prev);
      generated.categories.forEach((category) => merged.add(category));
      if (generated.category) {
        merged.add(generated.category);
      }
      return Array.from(merged);
    });
    if (generated.category) {
      setRandomCategory(generated.category);
    }
  };

  const handleInsertRandom = async () => {
    setError(null);
    try {
      const category = randomCategory === 'any' ? undefined : randomCategory;
      const generated = await randomTextMutation.mutateAsync(category);
      setText(generated.text.trim());
      handleRandomResult(generated);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAppendRandom = async () => {
    setError(null);
    try {
      const category = randomCategory === 'any' ? undefined : randomCategory;
      const generated = await randomTextMutation.mutateAsync(category);
      const next = [text.trim(), generated.text.trim()].filter(Boolean).join('\n\n');
      setText(next);
      handleRandomResult(generated);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSynthesize = async () => {
    setError(null);
    const script = text.trim();
    if (!script) {
      setError('Please enter some text before synthesising.');
      return;
    }
    if (!selectedVoices.length) {
      setError('Select at least one voice.');
      return;
    }
    if (!backendReady) {
      setError('Models or voices are missing. Download assets before synthesising.');
      return;
    }

    for (const voice of selectedVoices) {
      try {
        await synthMutation.mutateAsync({
          text: script,
          voice,
          language: normaliseLanguage(language),
          speed: Number(speed),
          trimSilence: Boolean(trimSilence),
        });
      } catch (err) {
        console.error(err);
        break;
      }
    }
  };

  const handleAudition = async () => {
    setError(null);
    const script = text.trim();
    if (!script) {
      setError('Please enter some text before building an audition.');
      return;
    }
    if (selectedVoices.length < 2) {
      setError('Select two or more voices for an audition.');
      return;
    }
    if (!backendReady) {
      setError('Models or voices are missing. Download assets before auditioning.');
      return;
    }

    const announcerConfig = announcerEnabled
      ? {
          enabled: true,
          voice: announcerVoice ?? undefined,
          template: (announcerTemplate || DEFAULT_ANNOUNCER_TEMPLATE).trim(),
          gapSeconds: Number.isFinite(announcerGap) ? announcerGap : 0,
          trim: Boolean(trimSilence),
        }
      : undefined;

    try {
      await auditionMutation.mutateAsync({
        text: script,
        voices: selectedVoices,
        speed: Number(speed),
        language: normaliseLanguage(language),
        trimSilence: Boolean(trimSilence),
        announcer: announcerConfig,
        gapSeconds: 1.0,
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveResult = (id: string) => {
    setResults((prev) => prev.filter((item) => item.id !== id));
  };

  const canSynthesize = backendReady && Boolean(text.trim()) && selectedVoices.length > 0;
  const hasMultipleVoices = backendReady && selectedVoices.length > 1;

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>Kokoro Playground SPA</h1>
          <p>Modernised single page interface for the local Kokoro TTS stack.</p>
        </div>
        <div className="app__stats">
          <p>{voicesQuery.isFetching ? 'Refreshing voices…' : `${voiceCount} voices`}</p>
          <p>{results.length} clips</p>
          <p>{ollamaAvailable ? 'Ollama connected' : 'Ollama offline'}</p>
        </div>
      </header>

      {error ? <div className="app__banner app__banner--error">{error}</div> : null}
      {voicesQuery.isError ? (
        <div className="app__banner app__banner--error">
          <p>Unable to load voices.</p>
          <button type="button" onClick={() => voicesQuery.refetch()}>
            Retry
          </button>
        </div>
      ) : null}
      {metaQuery.isError ? (
        <div className="app__banner app__banner--error">
          <p>Unable to load meta information.</p>
          <button type="button" onClick={() => metaQuery.refetch()}>
            Retry
          </button>
        </div>
      ) : null}
      {metaQuery.isSuccess && !backendReady ? (
        <div className="app__banner app__banner--warning">
          <p>Model or voice assets are missing. Update your `.env` paths or rerun the launcher to download assets.</p>
        </div>
      ) : null}

      <main className="app__layout">
        <div className="app__column">
          <TextWorkbench
            text={text}
            onChange={setText}
            onInsertRandom={handleInsertRandom}
            onAppendRandom={handleAppendRandom}
            isRandomLoading={randomTextMutation.isPending}
            categories={categories}
            selectedCategory={randomCategory}
            onCategoryChange={setRandomCategory}
          />
          <SynthesisControls
            language={language}
            languages={availableLanguages}
            onLanguageChange={(value) => setLanguage(normaliseLanguage(value))}
            speed={Number(speed)}
            onSpeedChange={(value) => setSpeed(Number(value))}
            trimSilence={Boolean(trimSilence)}
            onTrimSilenceChange={(value) => setTrimSilence(value)}
            autoPlay={Boolean(autoPlay)}
            onAutoPlayChange={(value) => setAutoPlay(value)}
          />
          <AnnouncerControls
            enabled={announcerEnabled}
            onEnabledChange={setAnnouncerEnabled}
            voices={voices}
            selectedVoice={announcerVoice}
            onVoiceChange={setAnnouncerVoice}
            template={announcerTemplate}
            onTemplateChange={setAnnouncerTemplate}
            gapSeconds={Number(announcerGap)}
            onGapChange={(value) => setAnnouncerGap(Number(value))}
          />
          <SynthesisActions
            canSynthesize={canSynthesize}
            hasMultipleVoices={hasMultipleVoices}
            onSynthesize={handleSynthesize}
            onAudition={handleAudition}
            isSynthLoading={synthMutation.isPending}
            isAuditionLoading={auditionMutation.isPending}
          />
        </div>
        <div className="app__column">
          {voicesQuery.isLoading ? (
            <section className="panel">
              <header className="panel__header">
                <h2 className="panel__title">Voices</h2>
              </header>
              <p className="panel__empty">Loading voices…</p>
            </section>
          ) : (
            <VoiceSelector
              voices={voices}
              groups={accentGroups.length ? accentGroups : undefined}
              selected={selectedVoices}
              onToggle={(voiceId) => {
                setError(null);
                const next = selectedVoices.includes(voiceId)
                  ? selectedVoices.filter((id) => id !== voiceId)
                  : [...selectedVoices, voiceId];
                setSelectedVoices(next);
              }}
              onClear={() => {
                setError(null);
                setSelectedVoices([]);
              }}
              activeGroup={voiceGroupFilter}
              onGroupChange={setVoiceGroupFilter}
            />
          )}
          <AudioResultList items={results} autoPlay={Boolean(autoPlay)} onRemove={handleRemoveResult} />
        </div>
      </main>
    </div>
  );
}

export default App;
