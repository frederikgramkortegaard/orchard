import { useCallback, useRef, useEffect, useState } from 'react';
import { useAudioStore } from '../stores/audio.store';

// Type declarations for Web Speech API
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

// Get the SpeechRecognition constructor (with browser prefix fallback)
function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function useSpeechRecognition() {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const durationIntervalRef = useRef<number | null>(null);
  const [interimTranscript, setInterimTranscript] = useState('');

  const {
    recordingState,
    recordingDuration,
    transcription,
    sttError,
    microphonePermission,
    setRecordingState,
    setRecordingDuration,
    setTranscription,
    setSttError,
    clearRecording,
    setMicrophonePermission,
  } = useAudioStore();

  // Check for browser support
  const isSupported = getSpeechRecognition() !== null;

  // Check microphone permission on mount
  useEffect(() => {
    const checkPermission = async () => {
      try {
        if (navigator.permissions) {
          const result = await navigator.permissions.query({
            name: 'microphone' as PermissionName,
          });
          setMicrophonePermission(result.state);
          result.onchange = () => {
            setMicrophonePermission(result.state);
          };
        }
      } catch {
        // Permission API not supported, we'll check when recording starts
        setMicrophonePermission('unknown');
      }
    };
    checkPermission();
  }, [setMicrophonePermission]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, []);

  const startRecording = useCallback(async () => {
    const SpeechRecognitionClass = getSpeechRecognition();

    if (!SpeechRecognitionClass) {
      setSttError('Speech recognition is not supported in this browser');
      return;
    }

    // Request microphone permission first
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicrophonePermission('granted');
    } catch (err) {
      setMicrophonePermission('denied');
      setSttError('Microphone access denied');
      return;
    }

    // Clear any previous state
    clearRecording();

    // Create new recognition instance
    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setRecordingState('recording');
      // Start duration timer
      const startTime = Date.now();
      durationIntervalRef.current = window.setInterval(() => {
        setRecordingDuration(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = '';
      let interimText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }

      // Only add final transcripts to the store
      if (finalText) {
        setTranscription((prev) => (prev ? prev + ' ' : '') + finalText.trim());
      }
      // Keep interim transcript in local state for display
      setInterimTranscript(interimText);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'aborted') {
        // User cancelled, not an error
        return;
      }
      setSttError(`Speech recognition error: ${event.error}`);
      setRecordingState('idle');
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
    };

    recognition.onend = () => {
      setRecordingState('idle');
      setInterimTranscript('');
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [
    clearRecording,
    setRecordingState,
    setRecordingDuration,
    setTranscription,
    setSttError,
    setMicrophonePermission,
  ]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  const cancelRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    setInterimTranscript('');
    clearRecording();
  }, [clearRecording]);

  // Full text including interim results for display
  const fullTranscription = transcription + (interimTranscript ? (transcription ? ' ' : '') + interimTranscript : '');

  return {
    // State
    isSupported,
    isRecording: recordingState === 'recording',
    recordingDuration,
    transcription,
    interimTranscript,
    fullTranscription,
    error: sttError,
    microphonePermission,

    // Actions
    startRecording,
    stopRecording,
    cancelRecording,
    clearTranscription: clearRecording,
  };
}
