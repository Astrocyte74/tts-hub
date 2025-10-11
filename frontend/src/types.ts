export interface RawVoiceRecord {
  id?: string;
  voice_id?: string;
  name?: string;
  locale?: string;
  lang?: string;
  language?: string;
  gender?: string;
  tags?: string[] | string;
  description?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface VoiceProfile {
  id: string;
  label: string;
  locale: string | null;
  gender: string | null;
  tags: string[];
  notes?: string;
  accent: VoiceAccentSummary;
  raw: RawVoiceRecord | string;
}

export interface VoiceAccentSummary {
  id: string;
  label: string;
  flag: string;
}

export interface ChatttsPreset {
  id: string;
  label: string;
  speaker: string;
  notes?: string;
  seed?: number;
}

export interface KokoroFavorite {
  id: string;
  voiceId: string;
  voiceLabel: string;
  label: string;
  notes?: string;
  locale?: string | null;
  accent?: VoiceAccentSummary | null;
  createdAt: string;
}

export interface TtsEngineMeta {
  id: string;
  label: string;
  description?: string;
  available: boolean;
  requiresVoice: boolean;
  supports?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  status?: string;
}

export interface VoiceCatalogue {
  engine: string;
  available: boolean;
  voices: VoiceProfile[];
  accentGroups: VoiceGroup[];
  count: number;
  styles?: string[];
  presets?: ChatttsPreset[];
  message?: string;
}

export interface VoiceGroup {
  id: string;
  label: string;
  flag?: string;
  count: number;
  voices: string[];
}

export interface SynthesisRequest {
  text: string;
  voice?: string;
  speed: number;
  language: string;
  trimSilence: boolean;
  engine?: string;
  style?: string;
  speaker?: string;
  seed?: number;
}

export interface SynthesisResponseShape {
  clip?: string;
  file?: string;
  filename?: string;
  path?: string;
  url?: string;
  audio_url?: string;
  [key: string]: unknown;
}

export interface SynthesisResult {
  id: string;
  voice: string;
  audioUrl: string;
  text: string;
  createdAt: string;
  engine?: string;
  meta: Record<string, unknown>;
}

export interface RandomTextResult {
  text: string;
  source: string;
  category: string;
  categories: string[];
}

export interface MetaResponse {
  api_prefix: string;
  port: number;
  has_model: boolean;
  has_voices: boolean;
  random_categories: string[];
  accent_groups?: VoiceGroup[];
  voice_count?: number;
  engines?: TtsEngineMeta[];
  default_engine?: string;
  frontend_bundle: {
    path: string;
    available: boolean;
  };
  ollama_available: boolean;
}

export interface AuditionAnnouncerConfig {
  enabled: boolean;
  voice?: string | null;
  template?: string;
  speed?: number;
  gapSeconds?: number;
  trim?: boolean;
  trim_silence?: boolean;
}

export interface AuditionRequest {
  text: string;
  voices: string[];
  speed: number;
  language: string;
  trimSilence: boolean;
  announcer?: AuditionAnnouncerConfig | null;
  gapSeconds?: number;
  engine?: string;
}
