import { create } from 'zustand';

export type RecordingState = 'idle' | 'recording' | 'processing';
export type PlaybackState = 'idle' | 'playing' | 'paused';

export interface AudioState {
  // Speech-to-Text state
  recordingState: RecordingState;
  recordingDuration: number;
  transcription: string;
  sttError: string | null;

  // Text-to-Speech state
  playbackState: PlaybackState;
  currentlyPlayingMessageId: string | null;
  ttsError: string | null;

  // Permissions
  microphonePermission: PermissionState | 'unknown';

  // Actions for STT
  setRecordingState: (state: RecordingState) => void;
  setRecordingDuration: (duration: number) => void;
  setTranscription: (text: string | ((prev: string) => string)) => void;
  appendTranscription: (text: string) => void;
  setSttError: (error: string | null) => void;
  clearRecording: () => void;

  // Actions for TTS
  setPlaybackState: (state: PlaybackState) => void;
  setCurrentlyPlayingMessageId: (id: string | null) => void;
  setTtsError: (error: string | null) => void;
  stopPlayback: () => void;

  // Actions for permissions
  setMicrophonePermission: (permission: PermissionState | 'unknown') => void;
}

export const useAudioStore = create<AudioState>((set) => ({
  // Initial STT state
  recordingState: 'idle',
  recordingDuration: 0,
  transcription: '',
  sttError: null,

  // Initial TTS state
  playbackState: 'idle',
  currentlyPlayingMessageId: null,
  ttsError: null,

  // Initial permissions
  microphonePermission: 'unknown',

  // STT actions
  setRecordingState: (recordingState) => set({ recordingState }),
  setRecordingDuration: (recordingDuration) => set({ recordingDuration }),
  setTranscription: (textOrUpdater) =>
    set((state) => ({
      transcription:
        typeof textOrUpdater === 'function'
          ? textOrUpdater(state.transcription)
          : textOrUpdater,
    })),
  appendTranscription: (text) =>
    set((state) => ({ transcription: state.transcription + text })),
  setSttError: (sttError) => set({ sttError }),
  clearRecording: () =>
    set({
      recordingState: 'idle',
      recordingDuration: 0,
      transcription: '',
      sttError: null,
    }),

  // TTS actions
  setPlaybackState: (playbackState) => set({ playbackState }),
  setCurrentlyPlayingMessageId: (currentlyPlayingMessageId) =>
    set({ currentlyPlayingMessageId }),
  setTtsError: (ttsError) => set({ ttsError }),
  stopPlayback: () =>
    set({
      playbackState: 'idle',
      currentlyPlayingMessageId: null,
      ttsError: null,
    }),

  // Permission actions
  setMicrophonePermission: (microphonePermission) => set({ microphonePermission }),
}));
