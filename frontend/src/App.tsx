import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import './App.css';
import { VoiceSelector } from './components/VoiceSelector';
import { TextWorkbench } from './components/TextWorkbench';
import { SynthesisControls } from './components/SynthesisControls';
import { EditFavoriteDialog } from './components/EditFavoriteDialog';
import { AnnouncerControls } from './components/AnnouncerControls';
import { CollapsiblePanel } from './components/CollapsiblePanel';
import { SynthesisActions } from './components/SynthesisActions';
import { AudioResultList } from './components/AudioResultList';
import { TopContextBar } from './components/TopContextBar';
import { ResultsDrawer } from './components/ResultsDrawer';
import { SettingsPopover } from './components/SettingsPopover';
import { PresetDialog } from './components/PresetDialog';
import { InfoDialog } from './components/InfoDialog';
import { ApiStatusFooter } from './components/ApiStatusFooter';
import { OllamaPanel } from './components/OllamaPanel';
import { FavoritesManagerDialog } from './components/FavoritesManagerDialog';
import { XttsCustomVoiceDialog } from './components/XttsCustomVoiceDialog';
import { XttsManageVoicesDialog } from './components/XttsManageVoicesDialog';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useSessionStorage } from './hooks/useSessionStorage';
import {
  createAudition,
  createChatttsPreset,
  type CreateChatttsPresetPayload,
  type CreateChatttsPresetResponse,
  fetchMeta,
  fetchRandomText,
  fetchVoices,
  fetchVoiceGroups,
  synthesiseClip,
  createVoicePreview,
  type CreateVoicePreviewParams,
  createProfile,
  listProfiles,
  exportProfiles,
  importProfiles,
  updateFavorite,
  deleteFavorite,
} from './api/client';
import type {
  KokoroFavorite,
  RandomTextResult,
  SynthesisRequest,
  SynthesisResult,
  VoiceCatalogue,
  VoiceProfile,
  AuditionAnnouncerConfig,
} from './types';

const FALLBACK_CATEGORIES = ['any', 'narration', 'promo', 'dialogue', 'news', 'story', 'whimsy'];
const DEFAULT_LANGUAGE = 'en-us';
const DEFAULT_ENGINE = 'kokoro';
const DEFAULT_TEXT = 'Welcome to the Kokoro Playground SPA. Try synthesising this line!';
const DEFAULT_ANNOUNCER_TEMPLATE = 'Now auditioning {voice_label}';
const PREVIEW_CAPABLE_ENGINE_IDS = ['kokoro', 'xtts', 'openvoice', 'chattts'] as const;
type PreviewEngineId = typeof PREVIEW_CAPABLE_ENGINE_IDS[number];
const PREVIEW_CAPABLE_ENGINES = new Set<PreviewEngineId>(PREVIEW_CAPABLE_ENGINE_IDS);

function normaliseLanguage(language: string | null | undefined): string {
  if (!language) {
    return DEFAULT_LANGUAGE;
  }
  return language.toLowerCase();
}

function makePreviewKey(engine: string, voiceId: string): string {
  return `${engine}::${voiceId}`;
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

type SaveDraft =
  | {
      type: 'chattts';
      action: 'create';
      resultId: string;
      voiceLabel: string;
      speaker: string;
      speakerSnippet: string;
      seed?: number;
      defaultLabel: string;
      defaultNotes?: string;
      existingLabel?: string | null;
    }
  | {
      type: 'kokoro';
      action: 'create' | 'update';
      resultId: string;
      voiceId: string;
      voiceLabel: string;
      locale?: string | null;
      accent?: {
        id?: string;
        label?: string;
        flag?: string;
      } | null;
      defaultLabel: string;
      defaultNotes?: string;
      existingLabel?: string | null;
      favoriteId?: string;
    };

function App() {
  const [text, setText] = useLocalStorage('kokoro:text', DEFAULT_TEXT);
  const [selectedVoices, setSelectedVoices] = useLocalStorage<string[]>('kokoro:selectedVoices', []);
  const [language, setLanguage] = useLocalStorage('kokoro:language', DEFAULT_LANGUAGE);
  const [speed, setSpeed] = useLocalStorage('kokoro:speed', 1);
  const [trimSilence, setTrimSilence] = useLocalStorage('kokoro:trimSilence', true);
  const [autoPlay, setAutoPlay] = useLocalStorage('kokoro:autoPlay', true);
  const [hoverPreview, setHoverPreview] = useLocalStorage('kokoro:hoverPreview', true);
  const [autoOpenClips, setAutoOpenClips] = useLocalStorage('kokoro:autoOpenClips', true);
  const [editorFontSize, setEditorFontSize] = useLocalStorage('kokoro:editorFontSize', 16);
  const [announcerEnabled, setAnnouncerEnabled] = useLocalStorage('kokoro:announcerEnabled', false);
  const [announcerVoice, setAnnouncerVoice] = useLocalStorage<string | null>('kokoro:announcerVoice', null);
  const [announcerTemplate, setAnnouncerTemplate] = useLocalStorage('kokoro:announcerTemplate', DEFAULT_ANNOUNCER_TEMPLATE);
  const [announcerGap, setAnnouncerGap] = useLocalStorage('kokoro:announcerGap', 0.5);
  const [voiceGroupFilter, setVoiceGroupFilter] = useLocalStorage('kokoro:voiceGroupFilter', 'all');
  const [results, setResults] = useState<SynthesisResult[]>([]);
  const [isResultsDrawerOpen, setResultsDrawerOpen] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  type QueueItem = {
    id: string;
    label: string;
    engine: string;
    status: 'pending' | 'rendering' | 'done' | 'error' | 'canceled';
    progress: number;
    startedAt?: string;
    finishedAt?: string;
    error?: string;
  };
  const [queue, setQueue] = useSessionStorage<QueueItem[]>('kokoro:queue.v1', []);
  const [persistedResults, setPersistedResults] = useSessionStorage<SynthesisResult[]>('kokoro:history.v1', []);
  const [highlightResultId, setHighlightResultId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extraCategories, setExtraCategories] = useState<string[]>([]);
  const [savingChatttsId, setSavingChatttsId] = useState<string | null>(null);
  const [saveDraft, setSaveDraft] = useState<SaveDraft | null>(null);
  const [kokoroFavorites, setKokoroFavorites] = useLocalStorage<KokoroFavorite[]>('kokoro:favorites', []);
  const [selectedKokoroFavoriteId, setSelectedKokoroFavoriteId] = useLocalStorage('kokoro:selectedFavorite', '');
  const [isFavoritesManagerOpen, setFavoritesManagerOpen] = useState(false);
  const [shouldReopenFavoritesManager, setShouldReopenFavoritesManager] = useState(false);
  const [openvoiceHelpOpen, setOpenvoiceHelpOpen] = useState(false);
  const [isAiAssistOpen, setAiAssistOpen] = useState(false);
  const [isXttsDialogOpen, setXttsDialogOpen] = useState(false);
  const [isXttsManageOpen, setXttsManageOpen] = useState(false);
  const [xttsEditTarget, setXttsEditTarget] = useState<string | null>(null);

  const [openvoiceStyle, setOpenvoiceStyle] = useLocalStorage('kokoro:openvoiceStyle', 'default');
  const [openvoiceVoiceStyles, setOpenvoiceVoiceStyles] = useLocalStorage<Record<string, string>>('kokoro:openvoiceVoiceStyles', {});
  const [chatttsSeed, setChatttsSeed] = useLocalStorage('kokoro:chatttsSeed', '');
  const [engineId, setEngineId] = useLocalStorage('kokoro:engine', DEFAULT_ENGINE);
  const [uiFavorites] = useLocalStorage<string[]>('kokoro:uiVoiceFavorites', []);
  const [voiceRecents, setVoiceRecents] = useLocalStorage<string[]>('kokoro:voiceRecents', []);
  const [previewBusy, setPreviewBusy] = useState<string[]>([]);
  const [activePanel, setActivePanel] = useLocalStorage<'script' | 'voices' | 'controls' | 'results'>('kokoro:activePanel', 'controls');
  const metaQuery = useQuery({ queryKey: ['meta'], queryFn: fetchMeta, staleTime: 5 * 60 * 1000 });
  const voicesQuery = useQuery({
    queryKey: ['voices', engineId],
    queryFn: () => fetchVoices(engineId),
    enabled: Boolean(engineId),
    staleTime: 5 * 60 * 1000,
  });
  const voiceGroupsQuery = useQuery({
    queryKey: ['voices-grouped', engineId],
    queryFn: () => fetchVoiceGroups(engineId),
    enabled: Boolean(engineId),
    staleTime: 5 * 60 * 1000,
  });

  const profilesQuery = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const res = await listProfiles();
      return res.profiles;
    },
    staleTime: 60 * 1000,
  });
  const profiles = useMemo(() => profilesQuery.data ?? [], [profilesQuery.data]);

  const engineList = useMemo(() => metaQuery.data?.engines ?? [], [metaQuery.data?.engines]);
  const defaultEngine = metaQuery.data?.default_engine ?? DEFAULT_ENGINE;

  useEffect(() => {
    if (!engineList.length) {
      if (!engineId && defaultEngine) {
        setEngineId(defaultEngine);
      }
      return;
    }
    const knownIds = new Set(engineList.map((engine) => engine.id));
    if (!engineId || !knownIds.has(engineId)) {
      const fallback = engineList.find((engine) => engine.id === defaultEngine) ?? engineList[0];
      if (fallback && fallback.id !== engineId) {
        setEngineId(fallback.id);
      }
    }
  }, [engineList, engineId, defaultEngine, setEngineId]);

  const selectedEngine = useMemo(() => engineList.find((engine) => engine.id === engineId) ?? null, [engineList, engineId]);

  useEffect(() => {
    setSelectedVoices([]);
    setVoiceGroupFilter('all');
    setAnnouncerVoice(null);
    setAnnouncerEnabled(false);
    if (engineId !== 'openvoice') {
      setOpenvoiceStyle('default');
    }
    if (engineId !== 'chattts' && chatttsSeed !== '') {
      setChatttsSeed('');
    }
  }, [engineId, chatttsSeed, setSelectedVoices, setVoiceGroupFilter, setAnnouncerVoice, setAnnouncerEnabled, setOpenvoiceStyle, setChatttsSeed]);

  const voiceCatalogue = voicesQuery.data as VoiceCatalogue | undefined;
  const voices = useMemo(() => voiceCatalogue?.voices ?? [], [voiceCatalogue]);
  const voiceById = useMemo(() => {
    const map = new Map<string, VoiceProfile>();
    voices.forEach((voice) => {
      map.set(voice.id, voice);
    });
    return map;
  }, [voices]);
  const previewBusyIdsForEngine = useMemo(() => {
    const prefix = `${engineId}::`;
    return previewBusy
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }, [previewBusy, engineId]);
  const supportsPreview = useMemo(() => PREVIEW_CAPABLE_ENGINES.has(engineId as PreviewEngineId), [engineId]);
  const getVoiceLabel = useCallback((id: string) => voiceById.get(id)?.label ?? id, [voiceById]);
  const buildPreviewPayload = useCallback(
    (voiceId: string): CreateVoicePreviewParams => {
      const payload: CreateVoicePreviewParams = {
        engine: engineId,
        voiceId,
      };
      const baseLanguage = normaliseLanguage(language);
      const voiceMeta = voiceById.get(voiceId);
      const rawMeta = (voiceMeta?.raw ?? {}) as Record<string, unknown>;
      const voiceType = typeof rawMeta.type === 'string' ? (rawMeta.type as string) : undefined;

      if (engineId === 'kokoro') {
        payload.language = baseLanguage;
        payload.speed = Number(speed);
        payload.trimSilence = Boolean(trimSilence);
      } else if (engineId === 'xtts') {
        payload.language = baseLanguage;
        payload.speed = Number(speed);
        payload.trimSilence = Boolean(trimSilence);
      } else if (engineId === 'openvoice') {
        const rawLanguage =
          typeof rawMeta.language === 'string' && rawMeta.language.trim()
            ? (rawMeta.language as string)
            : undefined;
        if (rawLanguage) {
          payload.language = rawLanguage;
        }
        const styleForVoice =
          openvoiceVoiceStyles[voiceId] ??
          openvoiceStyle ??
          (typeof rawMeta.style === 'string' && rawMeta.style.trim() ? (rawMeta.style as string) : 'default');
        payload.style = styleForVoice;
      } else if (engineId === 'chattts') {
        payload.language = baseLanguage;
        const speakerValue =
          typeof rawMeta.speaker === 'string' && rawMeta.speaker.trim()
            ? (rawMeta.speaker as string).trim()
            : undefined;
        if (speakerValue) {
          payload.speaker = speakerValue;
        }
        let seed: number | undefined;
        if (voiceType === 'preset') {
          if (typeof rawMeta.seed === 'number' && Number.isFinite(rawMeta.seed)) {
            seed = Math.floor(rawMeta.seed as number);
          }
        } else if (chatttsSeed && chatttsSeed.trim()) {
          const parsed = Number(chatttsSeed.trim());
          if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
            seed = Math.floor(parsed);
          }
        } else if (typeof rawMeta.seed === 'number' && Number.isFinite(rawMeta.seed)) {
          seed = Math.floor(rawMeta.seed as number);
        }
        if (seed !== undefined) {
          payload.seed = seed;
        }
      }
      return payload;
    },
    [engineId, language, trimSilence, speed, voiceById, openvoiceVoiceStyles, openvoiceStyle, chatttsSeed],
  );
  const handleGeneratePreview = useCallback(
    async (voiceId: string) => {
      if (!supportsPreview) {
        return;
      }
      const key = makePreviewKey(engineId, voiceId);
      setError(null);
      try {
        setPreviewBusy((prev) => (prev.includes(key) ? prev : [...prev, key]));
        await createVoicePreview(buildPreviewPayload(voiceId));
        await voicesQuery.refetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to generate preview.');
      } finally {
        setPreviewBusy((prev) => prev.filter((value) => value !== key));
      }
    },
    [supportsPreview, engineId, buildPreviewPayload, setError, setPreviewBusy, voicesQuery],
  );
  const handleBulkGeneratePreview = useCallback(
    async (voiceIds: string[]) => {
      if (!supportsPreview) {
        return;
      }
      const uniqueIds = Array.from(new Set(voiceIds));
      if (!uniqueIds.length) {
        return;
      }
      const availableIds: string[] = [];
      for (const id of uniqueIds) {
        const key = makePreviewKey(engineId, id);
        const busy = previewBusy.includes(key);
        const queued = queue.some(
          (item) =>
            item.engine === engineId &&
            item.id.startsWith(`pv-${engineId}-${id}-`) &&
            (item.status === 'pending' || item.status === 'rendering'),
        );
        if (busy || queued) {
          continue;
        }
        availableIds.push(id);
      }
      if (!availableIds.length) {
        return;
      }
      const newKeys = availableIds.map((id) => makePreviewKey(engineId, id));
      setPreviewBusy((prev) => Array.from(new Set([...prev, ...newKeys])));
      setResultsDrawerOpen(true);

      const queueEntries = new Map<string, string>();
      const baseTime = Date.now();
      const newItems = availableIds.map((id, index) => {
        const queueId = `pv-${engineId}-${id}-${baseTime + index}`;
        queueEntries.set(id, queueId);
        return {
          id: queueId,
          label: `Preview · ${getVoiceLabel(id)}`,
          engine: engineId,
          status: 'pending' as QueueItem['status'],
          progress: 0,
          startedAt: new Date().toISOString(),
        };
      });
      if (newItems.length) {
        setQueue((prev) => [...prev, ...newItems]);
      }

      let firstError: string | null = null;
      try {
        for (const id of availableIds) {
          const queueId = queueEntries.get(id);
          if (!queueId) continue;
          setQueue((prev) =>
            prev.map((item) =>
              item.id === queueId && item.status === 'pending' ? { ...item, status: 'rendering' } : item,
            ),
          );
          try {
            await createVoicePreview(buildPreviewPayload(id));
            setQueue((prev) =>
              prev.map((item) =>
                item.id === queueId && (item.status === 'rendering' || item.status === 'pending')
                  ? { ...item, status: 'done', progress: 100, finishedAt: new Date().toISOString() }
                  : item,
              ),
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to generate preview.';
            if (!firstError) {
              firstError = message;
            }
            setQueue((prev) =>
              prev.map((item) =>
                item.id === queueId ? { ...item, status: 'error', error: message } : item,
              ),
            );
          }
        }
        await voicesQuery.refetch();
        if (firstError) {
          setError(firstError);
        }
      } finally {
        setPreviewBusy((prev) => prev.filter((key) => !newKeys.includes(key)));
      }
    },
    [supportsPreview, engineId, previewBusy, queue, setPreviewBusy, setResultsDrawerOpen, getVoiceLabel, setQueue, buildPreviewPayload, voicesQuery, setError],
  );
  const chatttsPresets = useMemo(() => voiceCatalogue?.presets ?? [], [voiceCatalogue?.presets]);
  const kokoroFavoritesByVoice = useMemo(() => {
    return kokoroFavorites.reduce<Record<string, { label: string; count: number }>>((acc, favorite) => {
      const existing = acc[favorite.voiceId];
      acc[favorite.voiceId] = {
        label: favorite.label || favorite.voiceLabel || favorite.voiceId,
        count: existing ? existing.count + 1 : 1,
      };
      return acc;
    }, {});
  }, [kokoroFavorites]);
  const kokoroFavoriteOptions = useMemo(() => {
    if (!kokoroFavorites.length) {
      return [];
    }
    const voiceMap = new Map(voices.map((voice) => [voice.id, voice]));
    return kokoroFavorites
      .map((favorite) => {
        const voice = voiceMap.get(favorite.voiceId);
        const displayVoiceLabel = voice?.label ?? favorite.voiceLabel ?? favorite.voiceId;
        const accentSource = favorite.accent ?? voice?.accent ?? null;
        const accentLabel = accentSource
          ? `${accentSource.flag ?? ''} ${accentSource.label ?? ''}`.trim()
          : undefined;
        return {
          id: favorite.id,
          label: favorite.label || displayVoiceLabel,
          voiceLabel: displayVoiceLabel,
          voiceId: favorite.voiceId,
          accentLabel: accentLabel && accentLabel !== '' ? accentLabel : undefined,
          notes: favorite.notes,
          unavailable: !voice,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [kokoroFavorites, voices]);

  const quickRecentVoices = useMemo(() => {
    const base = voiceRecents.length ? voiceRecents : [];
    const mapped = base
      .map((id) => ({ id, label: voiceById.get(id)?.label ?? id }))
      .filter((v) => v.label && v.id)
      .slice(0, 5);
    return mapped;
  }, [voiceRecents, voiceById]);

  const quickFavoriteVoices = useMemo(() => {
    const favIds = new Set<string>(uiFavorites);
    kokoroFavorites.forEach((f) => favIds.add(f.voiceId));
    const out: { id: string; label: string }[] = [];
    favIds.forEach((id) => {
      const voice = voiceById.get(id);
      if (voice) out.push({ id, label: voice.label });
    });
    return out.sort((a, b) => a.label.localeCompare(b.label)).slice(0, 5);
  }, [uiFavorites, kokoroFavorites, voiceById]);

  const quickProfiles = useMemo(
    () =>
      profiles
        .map((profile) => ({
          id: profile.id,
          label: profile.label,
          engine: profile.engine,
          voiceId: profile.voiceId,
          notes: profile.notes,
        }))
        .filter((profile) => profile.id && profile.label && profile.engine && profile.voiceId)
        .slice(0, 5),
    [profiles],
  );

  const starredVoiceIds = useMemo(
    () =>
      profiles
        .filter((profile) => profile.engine === engineId)
        .map((profile) => profile.voiceId)
        .filter(Boolean),
    [profiles, engineId],
  );

  const getFavoriteByVoice = (voiceId: string): { id: string } | null => {
    const match = profiles.find((profile) => profile.engine === engineId && profile.voiceId === voiceId);
    return match ? { id: match.id } : null;
  };

  const [editingFavoriteId, setEditingFavoriteId] = useState<string | null>(null);
  const editingFavorite = useMemo(() => {
    if (!editingFavoriteId) return null;
    const profile = profiles.find((item) => item.id === editingFavoriteId);
    if (!profile) return null;
    return {
      id: profile.id,
      label: profile.label,
      engine: profile.engine,
      voiceId: profile.voiceId,
      language: profile.language,
      speed: profile.speed,
      trimSilence: profile.trimSilence,
      style: profile.style,
      seed: profile.seed,
      notes: profile.notes,
    };
  }, [editingFavoriteId, profiles]);

  const openFavoriteEditor = useCallback((id: string) => {
    const profile = profiles.find((p) => p.id === id);
    if (!profile) {
      setEditingFavoriteId(id);
      return;
    }
    if (profile.engine === 'xtts' && profile.voiceId) {
      setEditingFavoriteId(null);
      setXttsEditTarget(profile.voiceId);
      setActivePanel('voices');
      setXttsManageOpen(true);
      return;
    }
    setEditingFavoriteId(id);
  }, [profiles, setActivePanel]);

  const favoritesNotesByVoiceMap = useMemo(() => {
    const map: Record<string, string> = {};
    profiles.forEach((profile) => {
      if (profile.engine !== engineId) return;
      if (profile.voiceId && profile.notes) {
        map[profile.voiceId] = profile.notes;
      }
    });
    return map;
  }, [profiles, engineId]);

  const favoritesMetaByVoiceMap = useMemo(() => {
    const map: Record<string, { language?: string; speed?: number; trimSilence?: boolean }> = {};
    profiles.forEach((profile) => {
      if (profile.engine !== engineId || !profile.voiceId) return;
      map[profile.voiceId] = {
        language: profile.language,
        speed: profile.speed,
        trimSilence: profile.trimSilence,
      };
    });
    return map;
  }, [profiles, engineId]);

  const favoritesForManager = useMemo(
    () =>
      profiles.map((profile) => ({
        id: profile.id,
        label: profile.label,
        engine: profile.engine,
        voiceId: profile.voiceId,
        notes: profile.notes,
      })),
    [profiles],
  );

  const localFavoritesForManager = useMemo(
    () =>
      kokoroFavorites.map((favorite) => ({
        id: favorite.id,
        label: favorite.label || favorite.voiceLabel || favorite.voiceId,
        engine: 'kokoro',
        voiceId: favorite.voiceId,
        notes: favorite.notes,
      })),
    [kokoroFavorites],
  );

  // Defer definition until after backendReady is computed below
  // star/unstar handles saving favorites

  useEffect(() => {
    if (engineId !== 'kokoro') {
      if (selectedKokoroFavoriteId !== '') {
        setSelectedKokoroFavoriteId('');
      }
      return;
    }
    if (!selectedKokoroFavoriteId) {
      return;
    }
    const favorite = kokoroFavorites.find((entry) => entry.id === selectedKokoroFavoriteId);
    if (!favorite) {
      setSelectedKokoroFavoriteId('');
      return;
    }
    const voiceExists = voices.some((voice) => voice.id === favorite.voiceId);
    if (!voiceExists) {
      return;
    }
    if (selectedVoices.length !== 1 || !selectedVoices.includes(favorite.voiceId)) {
      setSelectedKokoroFavoriteId('');
    }
  }, [engineId, kokoroFavorites, selectedVoices, selectedKokoroFavoriteId, setSelectedKokoroFavoriteId, voices]);
  const voiceGroupData = useMemo(() => {
    if (voiceGroupsQuery.data && voiceGroupsQuery.data.length) {
      return voiceGroupsQuery.data;
    }
    if (voiceCatalogue?.accentGroups?.length) {
      return voiceCatalogue.accentGroups;
    }
    if (engineId === 'kokoro') {
      return metaQuery.data?.accent_groups ?? [];
    }
    return [];
  }, [voiceGroupsQuery.data, voiceCatalogue?.accentGroups, metaQuery.data?.accent_groups, engineId]);
  const accentGroups = voiceGroupData;
  const voiceCount = voiceCatalogue?.count ?? voices.length;
  const styleOptions = useMemo(() => voiceCatalogue?.styles ?? [], [voiceCatalogue?.styles]);
  const engineAvailable = voiceCatalogue ? voiceCatalogue.available : selectedEngine?.available ?? true;
  const engineMessage = voiceCatalogue?.message ?? selectedEngine?.description;
  const ollamaAvailable = metaQuery.data?.ollama_available ?? false;
  const kokoroReady = metaQuery.data ? metaQuery.data.has_model && metaQuery.data.has_voices : true;
  const backendReady = engineId === 'kokoro' ? engineAvailable && kokoroReady : engineAvailable;
  // removed quick save enablement
  const engineStatus = selectedEngine?.status ?? null;

  const applyOpenvoiceStyle = (style: string, options: { updateOverrides?: boolean } = {}) => {
    setOpenvoiceStyle(style);
    if (options.updateOverrides === false) {
      return;
    }
    if (engineId !== 'openvoice' || !selectedVoices.length) {
      return;
    }
    const next = { ...openvoiceVoiceStyles };
    let changed = false;
    selectedVoices.forEach((voiceId) => {
      if (style === 'default') {
        if (voiceId in next) {
          delete next[voiceId];
          changed = true;
        }
        return;
      }
      if (next[voiceId] !== style) {
        next[voiceId] = style;
        changed = true;
      }
    });
    if (changed) {
      setOpenvoiceVoiceStyles(next);
    }
  };

  const handleOpenvoiceStyleChange = (style: string) => {
    applyOpenvoiceStyle(style);
  };

  const handleOpenvoiceVoiceStyleChange = (voiceId: string, style: string) => {
    const nextStyle = style || 'default';
    const currentStyles = openvoiceVoiceStyles;
    const current = currentStyles[voiceId];
    if (current === nextStyle) {
      return;
    }

    if (nextStyle === 'default') {
      if (!(voiceId in currentStyles)) {
        return;
      }
      const rest = { ...currentStyles };
      delete rest[voiceId];
      setOpenvoiceVoiceStyles(rest);
    } else {
      setOpenvoiceVoiceStyles({
        ...currentStyles,
        [voiceId]: nextStyle,
      });
    }

    if (engineId === 'openvoice' && selectedVoices.length === 1 && selectedVoices[0] === voiceId) {
      applyOpenvoiceStyle(nextStyle, { updateOverrides: false });
      setOpenvoiceStyle(nextStyle);
    }
  };


  useEffect(() => {
    if (engineId !== 'openvoice') {
      return;
    }
    if (styleOptions.length) {
      if (!openvoiceStyle || !styleOptions.includes(openvoiceStyle)) {
        setOpenvoiceStyle(styleOptions[0]);
      }
    } else if (openvoiceStyle !== 'default') {
      setOpenvoiceStyle('default');
    }
  }, [engineId, styleOptions, openvoiceStyle, setOpenvoiceStyle]);

  useEffect(() => {
    if (engineId !== 'openvoice') {
      return;
    }
    if (selectedVoices.length === 1) {
      const voiceId = selectedVoices[0];
      const storedStyle = openvoiceVoiceStyles[voiceId];
      if (storedStyle && storedStyle !== openvoiceStyle) {
        setOpenvoiceStyle(storedStyle);
      }
    }
  }, [engineId, selectedVoices, openvoiceVoiceStyles, openvoiceStyle, setOpenvoiceStyle]);

  useEffect(() => {
    if (engineId !== 'chattts') {
      return;
    }
    if (voices.length && selectedVoices.length === 0) {
      setSelectedVoices([voices[0].id]);
    }
  }, [engineId, voices, selectedVoices, setSelectedVoices]);

  useEffect(() => {
    if (engineId !== 'chattts') {
      return;
    }
    if (!chatttsSeed) {
      return;
    }
    const parsed = Number(chatttsSeed);
    if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
      setChatttsSeed('');
    }
  }, [engineId, chatttsSeed, setChatttsSeed]);

  useEffect(() => {
    if (engineId !== 'chattts' && savingChatttsId !== null) {
      setSavingChatttsId(null);
    }
    if (!saveDraft) {
      return;
    }
    if (saveDraft.type === 'chattts' && engineId !== 'chattts') {
      setSaveDraft(null);
    } else if (saveDraft.type === 'kokoro' && engineId !== 'kokoro') {
      setSaveDraft(null);
    }
  }, [engineId, savingChatttsId, saveDraft]);

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

  // Queue housekeeping: prune finished items after a short delay so Queue stays focused
  useEffect(() => {
    const interval = window.setInterval(() => {
      setQueue((prev) => {
        const now = Date.now();
        return prev.filter((it) => {
          if ((it.status === 'pending') || (it.status === 'rendering')) return true;
          if (it.status === 'done' && it.finishedAt) {
            const finished = new Date(it.finishedAt).getTime();
            // Keep around for 10s, then prune
            return now - finished < 10_000;
          }
          // Retain errors for visibility
          if (it.status === 'error') return true;
          return false;
        });
      });
    }, 4_000);
    return () => window.clearInterval(interval);
  }, [setQueue]);

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

  const synthMutation = useMutation<SynthesisResult, unknown, SynthesisRequest & { style?: string; speaker?: string; seed?: number }>({
    mutationFn: synthesiseClip,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Synthesis request failed.');
    },
  });

  const chatttsPresetMutation = useMutation<CreateChatttsPresetResponse, unknown, CreateChatttsPresetPayload>({
    mutationFn: (payload) => createChatttsPreset(payload),
    onSuccess: (response) => {
      const presetId = response?.preset?.id;
      if (presetId && engineId === 'chattts') {
        const presetVoiceId = `chattts_preset_${presetId}`;
        setSelectedVoices([presetVoiceId]);
      }
      voicesQuery.refetch();
      voiceGroupsQuery.refetch();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to save ChatTTS preset.');
    },
  });

  const formatSpeakerSnippet = (value: string): string => {
    const trimmed = value.trim();
    if (trimmed.length <= 16) {
      return trimmed;
    }
    return `${trimmed.slice(0, 8)}…${trimmed.slice(-8)}`;
  };

  const resolveSeed = (candidate: unknown): number | undefined => {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === 'string' && candidate.trim()) {
      const parsed = Number(candidate.trim());
      if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
        return Math.floor(parsed);
      }
    }
    return undefined;
  };

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

  const handleSaveChatttsPresetFromResult = (result: SynthesisResult) => {
    if (chatttsPresetMutation.isPending || savingChatttsId) {
      return;
    }
    setError(null);
    const meta = (result.meta ?? {}) as Record<string, unknown>;
    const speakerRaw = typeof meta.speaker === 'string' ? meta.speaker.trim() : '';
    if (!speakerRaw) {
      setError('Selected ChatTTS clip is missing speaker metadata. Regenerate and try again.');
      return;
    }
    const fallbackSeed = resolveSeed(meta.seed) ?? resolveSeed(chatttsSeed);
    const existingPreset = chatttsPresets.find((preset) => preset.speaker === speakerRaw);
    setSaveDraft({
      type: 'chattts',
      action: 'create',
      resultId: result.id,
      speaker: speakerRaw,
      speakerSnippet: formatSpeakerSnippet(speakerRaw),
      seed: fallbackSeed,
      defaultLabel: fallbackSeed !== undefined ? `Seed ${fallbackSeed}` : 'ChatTTS Preset',
      defaultNotes: existingPreset?.notes,
      existingLabel: existingPreset?.label ?? null,
      voiceLabel: result.voice,
    });
  };

  const handleSaveKokoroFavoriteFromResult = (result: SynthesisResult) => {
    if (saveDraft?.type === 'kokoro') {
      return;
    }
    setError(null);
    const voiceId = typeof result.voice === 'string' ? result.voice : '';
    if (!voiceId) {
      setError('Selected clip is missing voice metadata.');
      return;
    }
    const meta = (result.meta ?? {}) as Record<string, unknown>;
    const accentFromMeta = ((meta.accent ?? null) as { id?: string; label?: string; flag?: string }) ?? null;
    const locale = typeof meta.locale === 'string' ? meta.locale : null;
    const voiceProfile = voices.find((voice) => voice.id === voiceId);
    const accent = voiceProfile?.accent ?? accentFromMeta;
    const existingFavorite = kokoroFavorites.find((favorite) => favorite.voiceId === voiceId) ?? null;
    const defaultLabel = voiceProfile?.label ?? result.voice;
    setSaveDraft({
      type: 'kokoro',
      action: 'create',
      resultId: result.id,
      voiceId,
      voiceLabel: voiceProfile?.label ?? result.voice,
      locale,
      accent,
      defaultLabel: defaultLabel || voiceId,
      defaultNotes: existingFavorite?.notes,
      existingLabel: existingFavorite?.label ?? null,
    });
  };

  const handleOpenFavoritesManager = () => {
    setShouldReopenFavoritesManager(false);
    setFavoritesManagerOpen(true);
  };

  const handleCloseFavoritesManager = () => {
    setShouldReopenFavoritesManager(false);
    setFavoritesManagerOpen(false);
  };

  const handleRenameFavorite = (favorite: KokoroFavorite) => {
    const voiceProfile = voices.find((voice) => voice.id === favorite.voiceId);
    const accent = favorite.accent ?? voiceProfile?.accent ?? null;
    setFavoritesManagerOpen(false);
    setShouldReopenFavoritesManager(true);
    setSaveDraft({
      type: 'kokoro',
      action: 'update',
      resultId: favorite.id,
      favoriteId: favorite.id,
      voiceId: favorite.voiceId,
      voiceLabel: voiceProfile?.label ?? favorite.voiceLabel,
      locale: favorite.locale ?? voiceProfile?.locale ?? null,
      accent,
      defaultLabel: favorite.label || voiceProfile?.label || favorite.voiceLabel || favorite.voiceId,
      defaultNotes: favorite.notes,
      existingLabel: favorite.label ?? null,
    });
  };

  const handleDeleteFavorite = (favorite: KokoroFavorite) => {
    const nextFavorites = kokoroFavorites.filter((entry) => entry.id !== favorite.id);
    setKokoroFavorites(nextFavorites);
    if (selectedKokoroFavoriteId === favorite.id) {
      setSelectedKokoroFavoriteId('');
    }
    if (!nextFavorites.length) {
      setFavoritesManagerOpen(false);
    }
    setShouldReopenFavoritesManager(false);
  };

  const handleKokoroFavoriteChange = (favoriteId: string) => {
    if (!favoriteId) {
      setSelectedKokoroFavoriteId('');
      return;
    }
    const favorite = kokoroFavorites.find((entry) => entry.id === favoriteId);
    if (!favorite) {
      setSelectedKokoroFavoriteId('');
      return;
    }
    const voiceExists = voices.some((voice) => voice.id === favorite.voiceId);
    if (!voiceExists) {
      setSelectedKokoroFavoriteId(favoriteId);
      setError('Favorite voice is not available in the current catalogue. Reinstall Kokoro voices to use it.');
      return;
    }
    setError(null);
    setSelectedVoices([favorite.voiceId]);
    setSelectedKokoroFavoriteId(favoriteId);
  };

  const handleDiscardSaveDraft = () => {
    if (saveDraft?.type === 'chattts' && savingChatttsId) {
      return;
    }
    setShouldReopenFavoritesManager(false);
    setSaveDraft(null);
  };

  const generateFavoriteId = () => {
    const globalCrypto = typeof globalThis !== 'undefined' ? (globalThis as typeof globalThis & { crypto?: Crypto }).crypto : undefined;
    if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
      return globalCrypto.randomUUID();
    }
    return `fav-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  };

  const handleConfirmSaveDraft = async (label: string, notes?: string, saveGlobalProfile?: boolean) => {
    if (!saveDraft) {
      return;
    }
    setError(null);
    if (saveDraft.type === 'chattts') {
      const payload: CreateChatttsPresetPayload = {
        label,
        speaker: saveDraft.speaker,
      };
      if (saveDraft.seed !== undefined) {
        payload.seed = saveDraft.seed;
      }
      if (notes && notes.trim()) {
        payload.notes = notes.trim();
      }
      setSavingChatttsId(saveDraft.resultId);
      try {
        await chatttsPresetMutation.mutateAsync(payload);
        setSaveDraft(null);
      } finally {
        setSavingChatttsId(null);
      }
      return;
    }

    if (saveDraft.type === 'kokoro') {
      const trimmedLabel = label.trim();
      const trimmedNotes = notes && notes.trim() ? notes.trim() : undefined;

      if (saveDraft.action === 'update' && saveDraft.favoriteId) {
        const updatedFavorites = kokoroFavorites.map((favorite) => {
          if (favorite.id !== saveDraft.favoriteId) {
            return favorite;
          }
          return {
            ...favorite,
            label: trimmedLabel || favorite.voiceLabel || saveDraft.voiceLabel,
            notes: trimmedNotes,
          };
        });
        setKokoroFavorites(updatedFavorites);
        if (shouldReopenFavoritesManager) {
          setFavoritesManagerOpen(true);
        }
        setShouldReopenFavoritesManager(false);
        setError(null);
        setSaveDraft(null);
        return;
      }
      const accent =
        saveDraft.accent && saveDraft.accent.id && saveDraft.accent.label && saveDraft.accent.flag
          ? {
              id: saveDraft.accent.id,
              label: saveDraft.accent.label,
              flag: saveDraft.accent.flag,
            }
          : null;

      const nextFavorite: KokoroFavorite = {
        id: generateFavoriteId(),
        voiceId: saveDraft.voiceId,
        voiceLabel: saveDraft.voiceLabel,
        label: trimmedLabel || saveDraft.voiceLabel,
        notes: trimmedNotes,
        locale: saveDraft.locale ?? null,
        accent,
        createdAt: new Date().toISOString(),
      };
      setKokoroFavorites([...kokoroFavorites, nextFavorite]);
      if (saveGlobalProfile) {
        try {
          await createProfile({
            label: nextFavorite.label,
            engine: 'kokoro',
            voiceId: nextFavorite.voiceId,
            language: (nextFavorite.locale ?? undefined) || 'en-us',
            tags: ['kokoro', 'favorite'],
            meta: {
              accent: nextFavorite.accent
                ? { id: nextFavorite.accent.id, label: nextFavorite.accent.label, flag: nextFavorite.accent.flag }
                : undefined,
              source: 'ui',
            },
          });
        } catch (err) {
          console.error('Failed to create global profile:', err);
        }
      }
      if (engineId === 'kokoro') {
        setSelectedVoices([saveDraft.voiceId]);
        setSelectedKokoroFavoriteId(nextFavorite.id);
      }
      setError(null);
      if (shouldReopenFavoritesManager) {
        setFavoritesManagerOpen(true);
      }
      setShouldReopenFavoritesManager(false);
      setSaveDraft(null);
      return;
    }
  };

  const isChatttsDraft = saveDraft?.type === 'chattts';
  const isKokoroDraft = saveDraft?.type === 'kokoro';
  const presetDialogTitle = isKokoroDraft ? 'Save Kokoro Favorite' : 'Save ChatTTS Preset';
  const presetDialogSubtitle = isKokoroDraft
    ? `Voice: ${saveDraft?.voiceLabel ?? ''}`
    : isChatttsDraft
    ? `Clip: ${saveDraft?.voiceLabel ?? ''} · Seed: ${
        saveDraft?.seed !== undefined ? saveDraft.seed : 'random'
      } · Speaker: ${saveDraft?.speakerSnippet ?? ''}`
    : undefined;
  const presetDialogContextItems = isKokoroDraft
    ? [
        saveDraft?.accent?.label || saveDraft?.accent?.flag
          ? `Accent: ${[saveDraft?.accent?.flag ?? '', saveDraft?.accent?.label ?? ''].join(' ').trim()}`
          : null,
        saveDraft?.locale ? `Locale: ${saveDraft.locale}` : null,
      ].filter((item): item is string => Boolean(item && item.trim()))
    : [];
  const presetDialogConfirmLabel = isKokoroDraft ? 'Save favorite' : 'Save preset';
  const presetDialogExistingSuffix = isKokoroDraft ? 'favorite' : 'preset';
  const presetDialogExistingHint = isKokoroDraft ? 'Already saved as favorite' : 'Already saved as preset';
  const presetDialogLabelField = isKokoroDraft ? 'Favorite name' : 'Preset name';
  const presetDialogLabelPlaceholder = isKokoroDraft ? 'My go-to Kokoro voice' : 'My favourite voice';
  const presetDialogNotesPlaceholder = isKokoroDraft
    ? 'Add notes about this favorite...'
    : 'Add context about this speaker...';
  const presetDialogEmptyError = isKokoroDraft ? 'Please enter a favorite name.' : 'Please enter a preset name.';
  const presetDialogIsSaving = Boolean(
    isChatttsDraft && saveDraft && savingChatttsId === saveDraft.resultId && chatttsPresetMutation.isPending,
  );

  // Restore persisted history once; then persist on change
  useEffect(() => {
    if (persistedResults.length && results.length === 0) {
      setResults(persistedResults);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    setPersistedResults(results);
  }, [results, setPersistedResults]);

  // Highlight newest clip briefly in Clips
  useEffect(() => {
    if (!results.length) return;
    setHighlightResultId(results[0].id);
    const t = window.setTimeout(() => setHighlightResultId(null), 1600);
    return () => window.clearTimeout(t);
  }, [results]);

  const handleSynthesize = useCallback(async () => {
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
      const message = engineAvailable
        ? 'Models or voices are missing. Download assets before synthesising.'
        : 'This engine is not ready yet.';
      setError(message);
      return;
    }

    let pendingOpenvoiceStyles: Record<string, string> | null = null;
    let openvoiceStylesChanged = false;
    const generateQueueId = () => `q-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const setStatus = (id: string, status: QueueItem['status'], patch: Partial<QueueItem> = {}) => {
      setQueue((prev) => prev.map((it) => (it.id === id ? { ...it, status, ...patch } : it)));
    };

    for (const voice of selectedVoices) {
      let qid = '';
      try {
        qid = generateQueueId();
        const voiceLabel = voiceById.get(voice)?.label ?? voice;
        setQueue((prev) => [
          ...prev,
          { id: qid, label: `Synthesis · ${voiceLabel}`, engine: engineId, status: 'pending', progress: 0, startedAt: new Date().toISOString() },
        ]);
        setResultsDrawerOpen(true);
        const payload: SynthesisRequest & { style?: string; speaker?: string; seed?: number } = {
          text: script,
          voice,
          language: normaliseLanguage(language),
          speed: Number(speed),
          trimSilence: Boolean(trimSilence),
          engine: engineId,
        };
        const voiceMeta = voiceById.get(voice);
        const rawMeta = (voiceMeta?.raw ?? {}) as Record<string, unknown>;
        const voiceType = typeof rawMeta.type === 'string' ? (rawMeta.type as string) : undefined;

        if (engineId === 'openvoice') {
          if (!pendingOpenvoiceStyles) {
            pendingOpenvoiceStyles = { ...openvoiceVoiceStyles };
          }
          const styleForVoice = pendingOpenvoiceStyles[voice] ?? openvoiceStyle ?? 'default';
          payload.style = styleForVoice;
          if (pendingOpenvoiceStyles[voice] !== styleForVoice) {
            pendingOpenvoiceStyles[voice] = styleForVoice;
            openvoiceStylesChanged = true;
          }
        }
        if (engineId === 'chattts') {
          if (voiceType === 'preset') {
            if (typeof rawMeta.speaker === 'string' && rawMeta.speaker.trim()) {
              payload.speaker = rawMeta.speaker.trim();
            }
            if (typeof rawMeta.seed === 'number' && Number.isFinite(rawMeta.seed)) {
              payload.seed = rawMeta.seed as number;
            }
          } else {
            if (typeof rawMeta.speaker === 'string' && rawMeta.speaker.trim()) {
              payload.speaker = rawMeta.speaker.trim();
            }
            if (chatttsSeed && chatttsSeed.trim() !== '') {
              const parsedSeed = Number(chatttsSeed.trim());
              if (!Number.isNaN(parsedSeed) && Number.isFinite(parsedSeed)) {
                payload.seed = Math.floor(parsedSeed);
              }
            }
          }
        }
        setStatus(qid, 'rendering');
        // optimistic progress while request runs
        let running = true;
        const tick = () => {
          setQueue((prev) => prev.map((it) => (it.id === qid && it.status === 'rendering' ? { ...it, progress: Math.min(90, (it.progress ?? 0) + 5) } : it)));
          if (running) timeout = window.setTimeout(tick, 350);
        };
        let timeout = window.setTimeout(tick, 350);
        const result = await synthMutation.mutateAsync(payload);
        running = false;
        window.clearTimeout(timeout);

        // enrich and store
        const enriched: SynthesisResult = { ...result, meta: { ...(result.meta ?? {}) } };
        if (payload.engine === 'openvoice') {
          const voiceId = payload.voice ?? '';
          const styleUsed = payload.style ?? openvoiceVoiceStyles[voiceId] ?? openvoiceStyle ?? 'default';
          const meta = enriched.meta as Record<string, unknown>;
          if (styleUsed && (!meta.style || typeof meta.style !== 'string')) meta.style = styleUsed;
          if (payload.language && (!meta.language || typeof meta.language !== 'string')) meta.language = payload.language;
          if (voiceId && (!meta.voice_id || typeof meta.voice_id !== 'string')) meta.voice_id = voiceId;
          if (voiceId && styleUsed && openvoiceVoiceStyles[voiceId] !== styleUsed) {
            setOpenvoiceVoiceStyles({ ...openvoiceVoiceStyles, [voiceId]: styleUsed });
          }
        }
        setResults((prev) => [enriched, ...prev]);
        // update recent voices (persisted)
        if (typeof enriched.voice === 'string' && enriched.voice) {
          setVoiceRecents((prev) => {
            const next = [enriched.voice, ...prev.filter((v) => v !== enriched.voice)];
            return next.slice(0, 10);
          });
        }
        setStatus(qid, 'done', { progress: 100, finishedAt: new Date().toISOString() });
      } catch (err) {
        console.error(err);
        if (qid) {
          setQueue((prev) => prev.map((it) => (it.id === qid ? { ...it, status: 'error', error: err instanceof Error ? err.message : 'Error' } : it)));
        }
        break;
      }
    }

    if (engineId === 'openvoice' && pendingOpenvoiceStyles && openvoiceStylesChanged) {
      setOpenvoiceVoiceStyles(pendingOpenvoiceStyles);
    }
  }, [
    chatttsSeed,
    engineAvailable,
    engineId,
    openvoiceStyle,
    openvoiceVoiceStyles,
    selectedVoices,
    setError,
    setOpenvoiceVoiceStyles,
    setQueue,
    setResults,
    setResultsDrawerOpen,
    setVoiceRecents,
    speed,
    trimSilence,
    language,
    text,
    backendReady,
    voiceById,
    synthMutation,
  ]);

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
      const message = engineAvailable
        ? 'Models or voices are missing. Download assets before auditioning.'
        : 'This engine is not ready yet.';
      setError(message);
      return;
    }

    const overridesByVoice: Record<string, Record<string, unknown>> = {};
    const auditionQueueId = `q-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    setQueue((prev) => [
      ...prev,
      { id: auditionQueueId, label: `Audition · ${selectedVoices.length} voices`, engine: engineId, status: 'pending', progress: 0, startedAt: new Date().toISOString() },
    ]);
    setResultsDrawerOpen(true);
    selectedVoices.forEach((voiceId) => {
      const override: Record<string, unknown> = {};
      const voiceMeta = voiceById.get(voiceId);
      const rawMeta = (voiceMeta?.raw ?? {}) as Record<string, unknown>;
      const voiceType = typeof rawMeta.type === 'string' ? (rawMeta.type as string) : undefined;

      if (engineId === 'openvoice') {
        override.style = openvoiceVoiceStyles[voiceId] ?? openvoiceStyle ?? 'default';
        override.language = normaliseLanguage(language);
      }
      if (engineId === 'chattts') {
        if (voiceType === 'preset') {
          if (typeof rawMeta.speaker === 'string' && rawMeta.speaker.trim()) {
            override.speaker = rawMeta.speaker.trim();
          }
          if (typeof rawMeta.seed === 'number' && Number.isFinite(rawMeta.seed)) {
            override.seed = rawMeta.seed;
          }
        } else {
          if (typeof rawMeta.speaker === 'string' && rawMeta.speaker.trim()) {
            override.speaker = rawMeta.speaker.trim();
          }
          if (chatttsSeed && chatttsSeed.trim()) {
            const parsed = Number(chatttsSeed.trim());
            if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
              override.seed = Math.floor(parsed);
            }
          }
        }
      }
      if (Object.keys(override).length > 0) {
        overridesByVoice[voiceId] = override;
      }
    });

    const voiceOverridesPayload: Record<string, Record<string, unknown>> = Object.fromEntries(
      Object.entries(overridesByVoice).filter(([, value]) => Object.keys(value).length > 0),
    );

    const announcerConfig: AuditionAnnouncerConfig | undefined = announcerEnabled
      ? {
          enabled: true,
          voice: announcerVoice ?? undefined,
          template: (announcerTemplate || DEFAULT_ANNOUNCER_TEMPLATE).trim(),
          gapSeconds: Number.isFinite(announcerGap) ? announcerGap : 0,
          trim: Boolean(trimSilence),
          speed: Number(speed),
          language: normaliseLanguage(language),
        }
      : undefined;

    if (announcerConfig && announcerConfig.voice && voiceOverridesPayload[announcerConfig.voice]) {
      announcerConfig.overrides = { ...voiceOverridesPayload[announcerConfig.voice] };
    }

    try {
      setQueue((prev) => prev.map((it) => (it.id === auditionQueueId ? { ...it, status: 'rendering' } : it)));
      // optimistic progress for audition
      let running = true;
      const tick = () => {
        setQueue((prev) => prev.map((it) => (it.id === auditionQueueId && it.status === 'rendering' ? { ...it, progress: Math.min(90, (it.progress ?? 0) + 5) } : it)));
        if (running) t = window.setTimeout(tick, 350);
      };
      let t = window.setTimeout(tick, 350);
      await auditionMutation.mutateAsync({
        text: script,
        voices: selectedVoices,
        speed: Number(speed),
        language: normaliseLanguage(language),
        trimSilence: Boolean(trimSilence),
        announcer: announcerConfig,
        gapSeconds: 1.0,
        engine: engineId,
        voiceOverrides: voiceOverridesPayload,
      });
      // best-effort: add each selected voice to recents
      if (Array.isArray(selectedVoices) && selectedVoices.length) {
        setVoiceRecents((prev) => {
          const merged = [...selectedVoices, ...prev.filter((v) => !selectedVoices.includes(v))];
          return merged.slice(0, 10);
        });
      }
      running = false;
      window.clearTimeout(t);
    } catch (err) {
      console.error(err);
      setQueue((prev) => prev.map((it) => (it.id === auditionQueueId ? { ...it, status: 'error', error: String(err) } : it)));
    }
    setQueue((prev) => prev.map((it) => (it.id === auditionQueueId ? { ...it, status: 'done', progress: 100, finishedAt: new Date().toISOString() } : it)));
  };

  const handleRemoveResult = (id: string) => {
    setResults((prev) => prev.filter((item) => item.id !== id));
    if (saveDraft && saveDraft.resultId === id) {
      setSaveDraft(null);
    }
  };

  const canSynthesize = backendReady && Boolean(text.trim()) && selectedVoices.length > 0;
  const hasMultipleVoices = backendReady && selectedVoices.length > 1;

  // Hotkeys: 1 Script, 2 Voices, 3 Controls, 4 Results; G Generate; R Results; V Voices; S Settings; Shift+/ AI Assist
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = (target?.tagName || '').toUpperCase();
      const editable = target?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const noMod = !e.metaKey && !e.ctrlKey && !e.altKey;
      if (editable && noMod) return; // don't steal plain typing

      const k = e.key.toLowerCase();
      if (noMod && k === '1') {
        e.preventDefault();
        setActivePanel('script');
      } else if (noMod && k === '2') {
        e.preventDefault();
        setActivePanel('voices');
      } else if (noMod && k === '3') {
        e.preventDefault();
        setActivePanel('controls');
      } else if (noMod && k === '4') {
        e.preventDefault();
        setActivePanel('results');
      } else if (noMod && k === 'g') {
        if (canSynthesize) {
          e.preventDefault();
          void handleSynthesize();
        }
      } else if (noMod && k === 'r') {
        e.preventDefault();
        setActivePanel('results');
      } else if (noMod && k === 'v') {
        e.preventDefault();
        setActivePanel('voices');
      } else if (noMod && k === 's') {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.shiftKey && k === '?') {
        e.preventDefault();
        setAiAssistOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canSynthesize, handleSynthesize, setActivePanel]);

  // Auto-open Clips when the queue becomes empty and results exist
  useEffect(() => {
    const active = queue.filter((q) => q.status === 'pending' || q.status === 'rendering').length;
    if (autoOpenClips && active === 0 && results.length) {
      setResultsDrawerOpen(true);
      setActivePanel('results');
    }
  }, [queue, autoOpenClips, results.length, setActivePanel]);

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>Kokoro Playground SPA</h1>
          <p>Modernised single page interface for the local Kokoro TTS stack.</p>
        </div>
        <div className="app__stats">
          <p>{voicesQuery.isFetching ? 'Refreshing voices…' : `${voiceCount} voices · ${(selectedEngine?.label ?? engineId ?? 'Engine')}`}</p>
          <p>{results.length} clips</p>
          <p>{ollamaAvailable ? 'Ollama connected' : 'Ollama offline'}</p>
        </div>
      </header>

      <TopContextBar
        engineLabel={selectedEngine?.label ?? engineId}
        engineStatus={engineStatus}
        engineReady={backendReady}
        voices={voices}
        selectedVoiceIds={selectedVoices}
        results={results}
        queueRunning={queue.filter((q) => q.status === 'pending' || q.status === 'rendering').length}
        queueTotal={queue.length}
        ollamaAvailable={ollamaAvailable}
        isResultsOpen={activePanel === 'results' ? true : isResultsDrawerOpen}
        canGenerate={canSynthesize}
        isGenerating={synthMutation.isPending}
        onQuickGenerate={handleSynthesize}
        onOpenSettings={() => setSettingsOpen(true)}
        onEngineClick={() => {
          setActivePanel('controls');
          setTimeout(() => {
            const el = document.getElementById('settings-anchor');
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 0);
        }}
        onToggleResults={() => setActivePanel('results')}
        onShowVoicePalette={() => {
          setActivePanel('voices');
        }}
        onAiAssistClick={() => setAiAssistOpen(true)}
        onOpenApiStatus={() => {
          const el = document.getElementById('api-status-footer');
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }
        }}
        quickFavorites={quickFavoriteVoices}
        quickRecents={quickRecentVoices}
        onQuickSelectVoice={(id) => {
          if (!id) return;
          setSelectedVoices([id]);
          setActivePanel('script');
        }}
        quickProfiles={quickProfiles}
        onQuickSelectProfile={(p) => {
          if (p.engine && p.engine !== engineId) {
            setEngineId(p.engine);
          }
          if (p.voiceId) {
            setSelectedVoices([p.voiceId]);
          }
          setActivePanel('script');
        }}
        onEditFavorite={(id) => openFavoriteEditor(id)}
        onDeleteFavorite={async (id) => { try { await deleteFavorite(id); profilesQuery.refetch(); } catch (err) { setError(err instanceof Error ? err.message : 'Delete failed'); } }}
        onOpenFavoritesManager={() => setFavoritesManagerOpen(true)}
        engines={engineList.map((engine) => ({ id: engine.id, label: engine.label, available: engine.available, status: engine.status }))}
        onEngineChange={(id) => setEngineId(id)}
        activePanel={activePanel}
        onChangePanel={setActivePanel}
      />

      {error ? <div className="app__banner app__banner--error">{error}</div> : null}
      {!engineAvailable ? (
        <div className="app__banner app__banner--warning">
          <p>
            {(selectedEngine?.label ?? engineId ?? 'Engine')} engine is not ready yet.{' '}
            {engineMessage ?? 'Complete the setup to enable synthesis.'}
          </p>
        </div>
      ) : null}
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

      <main className={`app__layout is-single`}>
        {activePanel === 'script' ? (
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
              onAiAssistClick={() => setAiAssistOpen(true)}
              aiAssistAvailable={ollamaAvailable}
              voices={voices}
              selectedVoiceIds={selectedVoices}
              onGoToVoices={() => setActivePanel('voices')}
              editorFontSize={Number(editorFontSize)}
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
        ) : activePanel === 'controls' ? (
          <div className="app__column">
            <div id="settings-anchor"></div>
            <SynthesisControls
              engineId={engineId}
              engines={engineList.map((engine) => ({
                id: engine.id,
                label: engine.label,
                available: engine.available,
                status: engine.status,
                description: engine.description,
              }))}
              onEngineChange={(value) => setEngineId(value)}
              engineAvailable={engineAvailable}
              engineMessage={engineMessage}
              language={language}
              languages={availableLanguages}
              onLanguageChange={(value) => setLanguage(normaliseLanguage(value))}
              speed={Number(speed)}
              onSpeedChange={(value) => setSpeed(Number(value))}
              trimSilence={Boolean(trimSilence)}
              onTrimSilenceChange={(value) => setTrimSilence(value)}
              autoPlay={Boolean(autoPlay)}
              onAutoPlayChange={(value) => setAutoPlay(value)}
              styleOptions={engineId === 'openvoice' ? styleOptions : undefined}
              selectedStyle={engineId === 'openvoice' ? openvoiceStyle : undefined}
              onStyleChange={engineId === 'openvoice' ? handleOpenvoiceStyleChange : undefined}
              chatttsSeed={engineId === 'chattts' ? chatttsSeed : undefined}
              onChatttsSeedChange={engineId === 'chattts' ? setChatttsSeed : undefined}
              kokoroFavoriteOptions={engineId === 'kokoro' ? kokoroFavoriteOptions : undefined}
              kokoroFavoriteId={engineId === 'kokoro' ? selectedKokoroFavoriteId : undefined}
              onKokoroFavoriteChange={engineId === 'kokoro' ? handleKokoroFavoriteChange : undefined}
              onManageKokoroFavorites={engineId === 'kokoro' ? handleOpenFavoritesManager : undefined}
              kokoroFavoritesCount={engineId === 'kokoro' ? kokoroFavorites.length : undefined}
              hideLanguageSpeed={true}
            />
            {engineAvailable ? (
              <CollapsiblePanel
                title="Announcer"
                storageKey="kokoro:collapse:announcer"
                defaultOpen={false}
              >
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
              </CollapsiblePanel>
            ) : null}
          </div>
        ) : activePanel === 'voices' ? (
          <div className="app__column" id="voice-selector-anchor">
          <VoiceSelector
            engineLabel={selectedEngine?.label ?? engineId ?? 'Engine'}
            engineAvailable={engineAvailable}
            engineMessage={engineMessage}
            isLoading={voicesQuery.isLoading}
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
              voiceStyles={engineId === 'openvoice' ? openvoiceVoiceStyles : undefined}
              styleOptions={engineId === 'openvoice' ? styleOptions : undefined}
              onVoiceStyleChange={engineId === 'openvoice' ? handleOpenvoiceVoiceStyleChange : undefined}
            onOpenvoiceInstructions={engineId === 'openvoice' ? () => setOpenvoiceHelpOpen(true) : undefined}
            favorites={starredVoiceIds}
            favoritesNotesByVoice={favoritesNotesByVoiceMap}
            favoritesMetaByVoice={favoritesMetaByVoiceMap}
            onCreateCustomVoice={engineId === 'xtts' ? () => setXttsDialogOpen(true) : undefined}
            onManageCustomVoices={engineId === 'xtts' ? () => setXttsManageOpen(true) : undefined}
            onEditCustomVoice={engineId === 'xtts' ? (id) => { setXttsEditTarget(id); setXttsManageOpen(true); } : undefined}
            accentOptions={engineId === 'xtts' ? (metaQuery.data?.accent_groups ?? []).map((g) => ({ id: (g as any)['id'] as string, label: (g as any)['label'] as string, flag: (g as any)['flag'] as string | undefined })) : undefined}
            onQuickVoiceMetaChanged={() => { voicesQuery.refetch(); voiceGroupsQuery.refetch(); }}
            languages={availableLanguages}
            language={language}
            onLanguageChange={(value) => setLanguage(normaliseLanguage(value))}
            speed={Number(speed)}
            onSpeedChange={(value) => setSpeed(Number(value))}
            onToggleFavorite={async (voiceId) => {
              setError(null);
              try {
                const existing = getFavoriteByVoice(voiceId);
                if (existing) {
                  await deleteFavorite(existing.id);
                } else {
                  const voiceLabel = voiceById.get(voiceId)?.label ?? voiceId;
                  const payload: Record<string, unknown> = {
                    label: `Favorite · ${voiceLabel}`,
                    engine: engineId,
                    voiceId,
                    language: normaliseLanguage(language),
                    speed: Number(speed),
                    trimSilence: Boolean(trimSilence),
                    tags: ['star'],
                    meta: { source: 'star' },
                  };
                  if (engineId === 'openvoice') payload['style'] = openvoiceVoiceStyles[voiceId] ?? openvoiceStyle ?? 'default';
                  if (engineId === 'chattts' && chatttsSeed && chatttsSeed.trim()) {
                    const parsed = Number(chatttsSeed.trim());
                    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) payload['seed'] = Math.floor(parsed);
                  }
                  await createProfile(payload);
                }
                profilesQuery.refetch();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to update favorite.');
              }
            }}
            onGeneratePreview={supportsPreview ? handleGeneratePreview : undefined}
            previewBusyIds={previewBusyIdsForEngine}
            onEditFavoriteVoice={(voiceId) => {
              const fav = getFavoriteByVoice(voiceId);
              if (fav) {
                openFavoriteEditor(fav.id);
              }
            }}
            onBulkGeneratePreview={supportsPreview ? handleBulkGeneratePreview : undefined}
            enableHoverPreview={Boolean(hoverPreview)}
          />
          </div>
        ) : (
          <div className="app__column">
            <AudioResultList
              items={results}
              autoPlay={Boolean(autoPlay)}
              onRemove={handleRemoveResult}
              onSaveChattts={engineId === 'chattts' ? handleSaveChatttsPresetFromResult : undefined}
              savingChatttsId={engineId === 'chattts' ? savingChatttsId : null}
              onSaveKokoroFavorite={handleSaveKokoroFavoriteFromResult}
              kokoroFavoritesByVoice={kokoroFavoritesByVoice}
            />
          </div>
        )}
      </main>
      {activePanel !== 'results' ? (
        <ResultsDrawer
          open={isResultsDrawerOpen}
          onToggle={() => setResultsDrawerOpen((v) => !v)}
          items={results}
          queue={queue}
          autoPlay={Boolean(autoPlay)}
          onRemove={handleRemoveResult}
          onCancelQueue={(id) => setQueue((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'canceled' } : it)))}
          onClearHistory={() => setResults([])}
          onClearQueue={() => setQueue([])}
          onSaveChattts={engineId === 'chattts' ? handleSaveChatttsPresetFromResult : undefined}
          savingChatttsId={engineId === 'chattts' ? savingChatttsId : null}
          onSaveKokoroFavorite={handleSaveKokoroFavoriteFromResult}
          kokoroFavoritesByVoice={kokoroFavoritesByVoice}
          highlightId={highlightResultId}
        />
      ) : null}
      <SettingsPopover
        open={isSettingsOpen}
        onClose={() => setSettingsOpen(false)}
        speed={Number(speed)}
        onSpeedChange={(value) => setSpeed(Number(value))}
        trimSilence={Boolean(trimSilence)}
        onTrimSilenceChange={(value) => setTrimSilence(Boolean(value))}
        autoPlay={Boolean(autoPlay)}
        onAutoPlayChange={(value) => setAutoPlay(Boolean(value))}
        hoverPreview={Boolean(hoverPreview)}
        onHoverPreviewChange={(value) => setHoverPreview(Boolean(value))}
        autoOpenClips={Boolean(autoOpenClips)}
        onAutoOpenClipsChange={(value) => setAutoOpenClips(Boolean(value))}
        recentCount={voiceRecents.length}
        onClearRecents={() => setVoiceRecents([])}
        editorFontSize={Number(editorFontSize)}
        onEditorFontSizeChange={(value) => setEditorFontSize(Number(value))}
      />
      {engineId === 'xtts' ? (
        <XttsCustomVoiceDialog
          isOpen={isXttsDialogOpen}
          onClose={() => setXttsDialogOpen(false)}
          onCreated={({ id }) => {
            setSelectedVoices([id]);
            voicesQuery.refetch();
            voiceGroupsQuery.refetch();
            setActivePanel('voices');
          }}
          onError={(message) => setError(message)}
        />
      ) : null}
      {engineId === 'xtts' ? (
        <XttsManageVoicesDialog
          isOpen={isXttsManageOpen}
          voices={voices}
          accentOptions={(metaQuery.data?.accent_groups ?? []).map((g) => ({ id: (g as any)['id'] as string, label: (g as any)['label'] as string, flag: (g as any)['flag'] as string | undefined }))}
          onClose={() => { setXttsManageOpen(false); setXttsEditTarget(null); }}
          onChanged={() => { voicesQuery.refetch(); voiceGroupsQuery.refetch(); }}
          onError={(message) => setError(message)}
          initialVoiceId={xttsEditTarget ?? undefined}
        />
      ) : null}
      {engineId === 'xtts' ? (
        <XttsCustomVoiceDialog
          isOpen={isXttsDialogOpen}
          onClose={() => setXttsDialogOpen(false)}
          onCreated={({ id }) => {
            setSelectedVoices([id]);
            voicesQuery.refetch();
            voiceGroupsQuery.refetch();
            setActivePanel('voices');
          }}
          onError={(message) => setError(message)}
        />
      ) : null}
      <FavoritesManagerDialog
        isOpen={isFavoritesManagerOpen}
        favorites={favoritesForManager}
        onClose={() => setFavoritesManagerOpen(false)}
        onEdit={(id) => openFavoriteEditor(id)}
        onDelete={async (id) => { try { await deleteFavorite(id); profilesQuery.refetch(); } catch (err) { setError(err instanceof Error ? err.message : 'Delete failed'); } }}
        voiceMetaMap={Object.fromEntries(voices.map((v) => [v.id, { locale: v.locale, gender: v.gender, accent: v.accent }]))}
        onExport={async () => {
          try {
            const data = await exportProfiles();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'kokoro-favorites.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Export failed');
          }
        }}
        onImport={async (data) => {
          try {
            if (data && typeof data === 'object') {
              const payload = { ...(data as Record<string, unknown>), mode: 'merge' as const };
              await importProfiles(payload);
              profilesQuery.refetch();
            } else {
              setError('Import file is not a valid favorites export.');
            }
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Import failed');
          }
        }}
      />
      <EditFavoriteDialog
        isOpen={Boolean(editingFavorite)}
        onClose={() => setEditingFavoriteId(null)}
        favorite={editingFavorite}
        onEditVoice={(voiceId) => {
          setEditingFavoriteId(null);
          setXttsEditTarget(voiceId);
          setXttsManageOpen(true);
        }}
        onSave={async (patch) => {
          try {
            await updateFavorite(patch.id, patch);
            profilesQuery.refetch();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save favorite');
          }
        }}
      />
      <FavoritesManagerDialog
        isOpen={isFavoritesManagerOpen}
        favorites={localFavoritesForManager}
        onClose={handleCloseFavoritesManager}
        onEdit={(id) => {
          const favorite = kokoroFavorites.find((entry) => entry.id === id);
          if (favorite) {
            handleRenameFavorite(favorite);
          }
        }}
        onDelete={(id) => {
          const favorite = kokoroFavorites.find((entry) => entry.id === id);
          if (favorite) {
            handleDeleteFavorite(favorite);
          }
        }}
        voiceMetaMap={Object.fromEntries(voices.map((v) => [v.id, { locale: v.locale, gender: v.gender, accent: v.accent }]))}
      />
      <InfoDialog
        isOpen={isAiAssistOpen}
        title="AI Assist"
        onClose={() => setAiAssistOpen(false)}
      >
        {ollamaAvailable ? (
          <div className="dialog-stack">
            <p>Use AI Assist to rewrite the current script. Choose a tone in the sidebar, preview changes, then accept to replace your text.</p>
            <p className="dialog-hint">Tip: adjust the prompt presets in <code>.env</code> to tailor rewrites to your workflow.</p>
          </div>
        ) : (
          <div className="dialog-stack">
            <p>Connect an Ollama instance to enable AI-assisted rewrites. Set <code>OLLAMA_URL</code> and <code>OLLAMA_MODEL</code> in your <code>.env</code>, then relaunch.</p>
          </div>
        )}
      </InfoDialog>
      <ApiStatusFooter meta={metaQuery.data} />
      <OllamaPanel />
      <PresetDialog
        isOpen={Boolean(saveDraft)}
        title={presetDialogTitle}
        subtitle={presetDialogSubtitle}
        contextItems={presetDialogContextItems}
        existingLabel={saveDraft?.existingLabel ?? null}
        existingLabelHint={saveDraft ? presetDialogExistingHint : undefined}
        existingLabelSuffix={presetDialogExistingSuffix}
        defaultLabel={saveDraft?.defaultLabel ?? (isKokoroDraft ? 'Kokoro Favorite' : 'ChatTTS Preset')}
        defaultNotes={saveDraft?.defaultNotes}
        onCancel={handleDiscardSaveDraft}
        onConfirm={handleConfirmSaveDraft}
        isSaving={presetDialogIsSaving}
        labelFieldLabel={presetDialogLabelField}
        labelPlaceholder={presetDialogLabelPlaceholder}
        notesPlaceholder={presetDialogNotesPlaceholder}
        confirmLabel={presetDialogConfirmLabel}
        emptyLabelError={presetDialogEmptyError}
        allowGlobalProfile={isKokoroDraft}
      />
      <InfoDialog
        isOpen={openvoiceHelpOpen}
        title="Using Custom OpenVoice References"
        onClose={() => setOpenvoiceHelpOpen(false)}
      >
        <p>
          You can clone any speaker with OpenVoice by dropping reference audio files into
          <code> openvoice/resources/</code>. Each file becomes a selectable voice the next time you reload voices.
        </p>
        <ol className="instruction-list">
          <li>Record 15–30 seconds of clean speech (no music, minimal background noise).</li>
          <li>
            Use the best mic you have—an iPhone 16 Pro Max (Voice Memos, lossless export) generally beats a laptop mic,
            thanks to better noise handling.
          </li>
          <li>Export the clip as WAV/MP3/FLAC/OGG (44.1 kHz or 48 kHz, mono or stereo).</li>
          <li>Copy the file into <code>openvoice/resources/</code> (feel free to organise by folders).</li>
          <li>Refresh the OpenVoice voices in the UI (or restart the backend) to pick up the new reference.</li>
        </ol>
        <p className="instruction-note">
          Tip: give each file a descriptive name like <code>demo_speaker_name.wav</code> so the playground labels are
          easy to scan.
        </p>
      </InfoDialog>
    </div>
  );
}

export default App;
