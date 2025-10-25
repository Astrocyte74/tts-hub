import type { MediaTranscriptResult } from '../types';

export type EditorStep = 'import' | 'align' | 'replace' | 'apply';

export type VoiceMode = 'borrow' | 'xtts' | 'favorite';

export interface Selection {
  start: number | null;
  end: number | null;
}

export interface EditorState {
  step: EditorStep;
  busy: boolean;
  status: string;
  error: string | null;

  jobId: string | null;
  audioUrl: string | null;
  transcript: MediaTranscriptResult | null;
  whisperxEnabled: boolean;
  selection: Selection;

  // Replace parameters
  voiceMode: VoiceMode;
  voiceId: string; // XTTS voice
  favoriteVoiceId: string; // Favorite resolves to voiceId server-side
  replaceText: string;
  timing: {
    marginSec: number; // used for region align and borrow voice
    fadeMs: number;
    trimEnable: boolean;
    trimTopDb: number;
    trimPrepadMs: number;
    trimPostpadMs: number;
  };

  previewUrl: string | null;
  finalUrl: string | null;
}

export type EditorAction =
  | { type: 'SET_STEP'; step: EditorStep }
  | { type: 'SET_BUSY'; busy: boolean; status?: string }
  | { type: 'SET_STATUS'; status: string }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_JOB'; jobId: string | null; audioUrl: string | null }
  | { type: 'SET_TRANSCRIPT'; transcript: MediaTranscriptResult | null }
  | { type: 'SET_WHISPERX_ENABLED'; value: boolean }
  | { type: 'SET_SELECTION'; start: number | null; end: number | null }
  | { type: 'SET_VOICE_MODE'; voiceMode: VoiceMode }
  | { type: 'SET_VOICE_ID'; voiceId: string }
  | { type: 'SET_FAVORITE_VOICE_ID'; favoriteVoiceId: string }
  | { type: 'SET_REPLACE_TEXT'; replaceText: string }
  | { type: 'SET_TIMING'; patch: Partial<EditorState['timing']> }
  | { type: 'SET_PREVIEW_URL'; previewUrl: string | null }
  | { type: 'SET_FINAL_URL'; finalUrl: string | null };

export function initialEditorState(): EditorState {
  return {
    step: 'import',
    busy: false,
    status: '',
    error: null,
    jobId: null,
    audioUrl: null,
    transcript: null,
    whisperxEnabled: false,
    selection: { start: null, end: null },
    voiceMode: 'borrow',
    voiceId: '',
    favoriteVoiceId: '',
    replaceText: '',
    timing: {
      marginSec: 0.75,
      fadeMs: 30,
      trimEnable: true,
      trimTopDb: 40,
      trimPrepadMs: 8,
      trimPostpadMs: 8,
    },
    previewUrl: null,
    finalUrl: null,
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, step: action.step };
    case 'SET_BUSY':
      return { ...state, busy: action.busy, status: action.status ?? state.status };
    case 'SET_STATUS':
      return { ...state, status: action.status };
    case 'SET_ERROR':
      return { ...state, error: action.error };
    case 'SET_JOB':
      return { ...state, jobId: action.jobId, audioUrl: action.audioUrl };
    case 'SET_TRANSCRIPT':
      return { ...state, transcript: action.transcript };
    case 'SET_WHISPERX_ENABLED':
      return { ...state, whisperxEnabled: action.value };
    case 'SET_SELECTION':
      return { ...state, selection: { start: action.start, end: action.end } };
    case 'SET_VOICE_MODE':
      return { ...state, voiceMode: action.voiceMode };
    case 'SET_VOICE_ID':
      return { ...state, voiceId: action.voiceId };
    case 'SET_FAVORITE_VOICE_ID':
      return { ...state, favoriteVoiceId: action.favoriteVoiceId };
    case 'SET_REPLACE_TEXT':
      return { ...state, replaceText: action.replaceText };
    case 'SET_TIMING':
      return { ...state, timing: { ...state.timing, ...action.patch } };
    case 'SET_PREVIEW_URL':
      return { ...state, previewUrl: action.previewUrl };
    case 'SET_FINAL_URL':
      return { ...state, finalUrl: action.finalUrl };
    default:
      return state;
  }
}

