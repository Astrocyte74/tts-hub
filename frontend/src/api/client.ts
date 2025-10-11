import type {
  AuditionRequest,
  ChatttsPreset,
  MetaResponse,
  RandomTextResult,
  RawVoiceRecord,
  SynthesisRequest,
  SynthesisResponseShape,
  SynthesisResult,
  VoiceGroup,
  VoiceProfile,
  VoiceCatalogue,
} from '../types';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const API_PREFIX = (import.meta.env.VITE_API_PREFIX as string | undefined)?.replace(/^\/|\/$/g, '') ?? 'api';

const jsonHeaders = { 'Content-Type': 'application/json' };
const DEFAULT_ACCENT = { id: 'other', label: 'Other / Mixed', flag: '🌐' } as const;

function buildUrl(path: string): string {
  const sanitized = path.replace(/^\//, '');
  if (BASE_URL) {
    const segments = [BASE_URL];
    if (API_PREFIX) {
      segments.push(API_PREFIX);
    }
    return `${segments.join('/')}/${sanitized}`.replace(/\/{2,}/g, '/').replace('http:/', 'http://').replace('https:/', 'https://');
  }

  const prefixPart = API_PREFIX ? `/${API_PREFIX}` : '';
  return `${prefixPart}/${sanitized}`.replace(/\/{2,}/g, '/');
}

function normaliseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

function coerceVoiceRecord(entry: RawVoiceRecord | string, index: number): VoiceProfile {
  if (typeof entry === 'string') {
    return {
      id: entry,
      label: entry,
      locale: null,
      gender: null,
      tags: [],
      accent: { ...DEFAULT_ACCENT },
      raw: entry,
    };
  }

  const id = String(
    entry.id ??
      entry.voice_id ??
      entry.name ??
      entry.voice ??
      entry.title ??
      `voice-${index + 1}`,
  );

  const labelSource = entry.name ?? entry.label ?? entry.display_name ?? id;
  const locale =
    (entry.locale ?? entry.lang ?? entry.language) && String(entry.locale ?? entry.lang ?? entry.language);
  const accentData = (entry as Record<string, unknown>).accent;
  const accent =
    accentData && typeof accentData === 'object'
      ? {
          id: String((accentData as Record<string, unknown>).id ?? DEFAULT_ACCENT.id),
          label: String((accentData as Record<string, unknown>).label ?? DEFAULT_ACCENT.label),
          flag: String((accentData as Record<string, unknown>).flag ?? DEFAULT_ACCENT.flag),
        }
      : { ...DEFAULT_ACCENT };

  return {
    id,
    label: String(labelSource),
    locale: locale ?? null,
    gender: entry.gender ? String(entry.gender) : null,
    tags: normaliseTags(entry.tags),
    notes: typeof entry.description === 'string' ? entry.description : entry.notes ? String(entry.notes) : undefined,
    accent,
    raw: entry,
  };
}

function extractVoiceList(input: unknown): (RawVoiceRecord | string)[] {
  if (!input) {
    return [];
  }
  if (Array.isArray(input)) {
    return input as (RawVoiceRecord | string)[];
  }
  if (typeof input === 'object') {
    const maybeVoices =
      (input as Record<string, unknown>).voices ??
      (input as Record<string, unknown>).items ??
      (input as Record<string, unknown>).data;
    if (Array.isArray(maybeVoices)) {
      return maybeVoices as (RawVoiceRecord | string)[];
    }
  }
  return [];
}

function coerceVoiceGroup(entry: unknown): VoiceGroup | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const raw = entry as Record<string, unknown>;
  if (typeof raw.id !== 'string') {
    return null;
  }
  if (!Array.isArray(raw.voices)) {
    return null;
  }
  const voices = raw.voices.map((value) => String(value));
  const count = typeof raw.count === 'number' ? raw.count : voices.length;
  const label = raw.label ? String(raw.label) : raw.id.toUpperCase();
  const flag = raw.flag ? String(raw.flag) : undefined;
  return { id: raw.id, label, flag, count, voices };
}

function coerceChatttsPreset(entry: unknown, index: number): ChatttsPreset | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const raw = entry as Record<string, unknown>;
  const speakerValue = raw.speaker;
  if (typeof speakerValue !== 'string') {
    return null;
  }
  const speaker = speakerValue.trim();
  if (!speaker) {
    return null;
  }
  const idCandidate = raw.id;
  const id =
    typeof idCandidate === 'string' && idCandidate.trim()
      ? idCandidate.trim()
      : `preset-${index + 1}`;
  const labelCandidate = raw.label;
  const label =
    typeof labelCandidate === 'string' && labelCandidate.trim()
      ? labelCandidate.trim()
      : id;
  const notesCandidate = raw.notes;
  const notes =
    typeof notesCandidate === 'string' && notesCandidate.trim()
      ? notesCandidate.trim()
      : undefined;
  const seedCandidate = raw.seed;
  const seed =
    typeof seedCandidate === 'number'
      ? Math.floor(seedCandidate)
      : typeof seedCandidate === 'string' && seedCandidate.trim() !== ''
      ? Number.parseInt(seedCandidate, 10)
      : undefined;
  const preset: ChatttsPreset = { id, label, speaker };
  if (notes) {
    preset.notes = notes;
  }
  if (Number.isFinite(seed)) {
    preset.seed = Number(seed);
  }
  return preset;
}

function resolveAudioUrl(candidate: string | undefined): string {
  if (!candidate) {
    throw new Error('No audio URL provided by the server response');
  }

  const trimmed = candidate.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith('/')) {
    return BASE_URL ? `${BASE_URL}${trimmed}` : trimmed;
  }

  // assume it is a filename under /audio/
  const audioPath = `audio/${trimmed}`.replace(/\/{2,}/g, '/');
  return BASE_URL ? `${BASE_URL}/${audioPath}` : `/${audioPath}`;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(buildUrl(path));
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${path} failed (${res.status}): ${text}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get('Content-Type') ?? '';
  if (!contentType.includes('json')) {
    throw new Error(`Expected JSON response from ${path} but received ${contentType || 'unknown content type'}`);
  }

  return res.json() as Promise<T>;
}

export async function fetchVoices(engineId?: string): Promise<VoiceCatalogue> {
  const url = engineId ? `voices?engine=${encodeURIComponent(engineId)}` : 'voices';
  const payload = await getJson<Record<string, unknown>>(url);
  const records = extractVoiceList(payload);
  const voices = records.map(coerceVoiceRecord);
  const accentCandidate = payload['accentGroups'];
  const groupSource = Array.isArray(accentCandidate)
    ? (accentCandidate as unknown[])
    : Array.isArray(payload['groups'])
    ? (payload['groups'] as unknown[])
    : [];
  const accentGroups = groupSource
    .map(coerceVoiceGroup)
    .filter((entry): entry is VoiceGroup => entry !== null);

  const engine = typeof payload['engine'] === 'string' ? (payload['engine'] as string) : engineId ?? 'kokoro';
  const available = payload['available'] !== false;
  const count = typeof payload['count'] === 'number' ? (payload['count'] as number) : voices.length;
  const message = typeof payload['message'] === 'string' ? (payload['message'] as string) : undefined;
  const styles = Array.isArray(payload['styles']) ? (payload['styles'] as string[]) : [];
  const presetsRaw = Array.isArray(payload['presets']) ? (payload['presets'] as unknown[]) : [];
  const presets = presetsRaw
    .map((entry, index) => coerceChatttsPreset(entry, index))
    .filter((item): item is ChatttsPreset => item !== null);

  return {
    engine,
    available,
    voices,
    accentGroups,
    count,
    styles,
    presets,
    message,
  };
}

export async function fetchVoiceGroups(engineId?: string): Promise<VoiceGroup[]> {
  const url = engineId ? `voices_grouped?engine=${encodeURIComponent(engineId)}` : 'voices_grouped';
  const payload = await getJson<Record<string, unknown>>(url);
  const groupSource = Array.isArray(payload['groups'])
    ? (payload['groups'] as unknown[])
    : Array.isArray(payload['accentGroups'])
    ? (payload['accentGroups'] as unknown[])
    : [];
  return groupSource
    .map(coerceVoiceGroup)
    .filter((entry): entry is VoiceGroup => entry !== null);
}

export async function fetchMeta(): Promise<MetaResponse> {
  return getJson<MetaResponse>('meta');
}

export async function fetchRandomText(category?: string): Promise<RandomTextResult> {
  const url = category ? `random_text?category=${encodeURIComponent(category)}` : 'random_text';
  const payload = await getJson<unknown>(url);
  if (typeof payload === 'string') {
    return {
      text: payload,
      source: 'local',
      category: category ?? 'any',
      categories: [],
    };
  }
  if (payload && typeof payload === 'object') {
    const candidate =
      (payload as Record<string, unknown>).text ??
      (payload as Record<string, unknown>).content ??
      (payload as Record<string, unknown>).data;
    const source = (payload as Record<string, unknown>).source;
    const categories = (payload as Record<string, unknown>).categories;
    const normalisedCategory = (payload as Record<string, unknown>).category;
    if (typeof candidate === 'string') {
      return {
        text: candidate,
        source: typeof source === 'string' ? source : 'local',
        category: typeof normalisedCategory === 'string' ? normalisedCategory : category ?? 'any',
        categories: Array.isArray(categories) ? categories.map((item) => String(item)) : [],
      };
    }
  }
  throw new Error('Unexpected random text response format');
}

export interface CreateChatttsPresetPayload {
  label: string;
  speaker: string;
  id?: string;
  notes?: string;
  seed?: number;
}

export interface CreateChatttsPresetResponse {
  preset: ChatttsPreset;
  presets: ChatttsPreset[];
}

export async function createChatttsPreset(payload: CreateChatttsPresetPayload): Promise<CreateChatttsPresetResponse> {
  return postJson<CreateChatttsPresetResponse>('chattts/presets', payload);
}

function synthesiseResultFromResponse(
  response: SynthesisResponseShape,
  fallbackVoice: string,
  text: string,
  engineId?: string,
): SynthesisResult {
  const audioUrl = resolveAudioUrl(
    (response.url as string | undefined) ??
      (response.audio_url as string | undefined) ??
      (response.path as string | undefined) ??
      (response.clip as string | undefined) ??
      (response.filename as string | undefined) ??
      (response.file as string | undefined),
  );

  const engine = typeof (response as Record<string, unknown>).engine === 'string'
    ? ((response as Record<string, unknown>).engine as string)
    : engineId;

  return {
    id:
      (response.id as string | undefined) ??
      (response.clip as string | undefined) ??
      (response.filename as string | undefined) ??
      crypto.randomUUID(),
    voice: (response.voice as string | undefined) ?? fallbackVoice,
    audioUrl,
    text,
    createdAt: new Date().toISOString(),
    engine,
    meta: response as Record<string, unknown>,
  };
}

export async function synthesiseClip(request: SynthesisRequest): Promise<SynthesisResult> {
  const payload = await postJson<SynthesisResponseShape>('synthesise', request).catch(async () => {
    // fallback to legacy endpoint name `synthesize`
    const fallback = await postJson<SynthesisResponseShape>('synthesize', request);
    return fallback;
  });

  return synthesiseResultFromResponse(payload, request.voice ?? 'unknown', request.text, request.engine);
}

export async function createAudition(request: AuditionRequest): Promise<SynthesisResult> {
  const payload = await postJson<SynthesisResponseShape>('audition', request);
  return synthesiseResultFromResponse(payload, 'audition', request.text, request.engine);
}
