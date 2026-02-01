import { useCallback, useRef, useEffect, useState } from 'react';
import { useAudioStore } from '../stores/audio.store';

export function useSpeechSynthesis() {
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);

  const {
    playbackState,
    currentlyPlayingMessageId,
    ttsError,
    setPlaybackState,
    setCurrentlyPlayingMessageId,
    setTtsError,
    stopPlayback,
  } = useAudioStore();

  // Check browser support
  const isSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window;

  // Load available voices
  useEffect(() => {
    if (!isSupported) return;

    const loadVoices = () => {
      const availableVoices = speechSynthesis.getVoices();
      setVoices(availableVoices);

      // Select a default English voice
      const englishVoice = availableVoices.find(
        (v) => v.lang.startsWith('en') && v.default
      ) || availableVoices.find((v) => v.lang.startsWith('en'));

      if (englishVoice && !selectedVoice) {
        setSelectedVoice(englishVoice);
      }
    };

    loadVoices();

    // Some browsers load voices asynchronously
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = loadVoices;
    }

    return () => {
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = null;
      }
    };
  }, [isSupported, selectedVoice]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isSupported) {
        speechSynthesis.cancel();
      }
    };
  }, [isSupported]);

  const speak = useCallback(
    (text: string, messageId?: string) => {
      if (!isSupported) {
        setTtsError('Text-to-speech is not supported in this browser');
        return;
      }

      // Cancel any ongoing speech
      speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);

      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      utterance.onstart = () => {
        setPlaybackState('playing');
        if (messageId) {
          setCurrentlyPlayingMessageId(messageId);
        }
      };

      utterance.onend = () => {
        stopPlayback();
      };

      utterance.onerror = (event) => {
        if (event.error === 'interrupted' || event.error === 'canceled') {
          // User interrupted, not an error
          stopPlayback();
          return;
        }
        setTtsError(`Speech synthesis error: ${event.error}`);
        stopPlayback();
      };

      utterance.onpause = () => {
        setPlaybackState('paused');
      };

      utterance.onresume = () => {
        setPlaybackState('playing');
      };

      utteranceRef.current = utterance;
      speechSynthesis.speak(utterance);
    },
    [
      isSupported,
      selectedVoice,
      setPlaybackState,
      setCurrentlyPlayingMessageId,
      setTtsError,
      stopPlayback,
    ]
  );

  const pause = useCallback(() => {
    if (isSupported && speechSynthesis.speaking) {
      speechSynthesis.pause();
    }
  }, [isSupported]);

  const resume = useCallback(() => {
    if (isSupported && speechSynthesis.paused) {
      speechSynthesis.resume();
    }
  }, [isSupported]);

  const stop = useCallback(() => {
    if (isSupported) {
      speechSynthesis.cancel();
    }
    stopPlayback();
  }, [isSupported, stopPlayback]);

  const togglePlayback = useCallback(
    (text: string, messageId?: string) => {
      if (currentlyPlayingMessageId === messageId && playbackState === 'playing') {
        pause();
      } else if (currentlyPlayingMessageId === messageId && playbackState === 'paused') {
        resume();
      } else {
        speak(text, messageId);
      }
    },
    [currentlyPlayingMessageId, playbackState, pause, resume, speak]
  );

  return {
    // State
    isSupported,
    isPlaying: playbackState === 'playing',
    isPaused: playbackState === 'paused',
    currentlyPlayingMessageId,
    error: ttsError,
    voices,
    selectedVoice,

    // Actions
    speak,
    pause,
    resume,
    stop,
    togglePlayback,
    setSelectedVoice,
  };
}
