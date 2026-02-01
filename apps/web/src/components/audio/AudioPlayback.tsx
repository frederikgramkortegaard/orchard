import { Volume2, VolumeX, Pause, Play } from 'lucide-react';
import { useSpeechSynthesis } from '../../hooks/useSpeechSynthesis';

interface AudioPlaybackProps {
  text: string;
  messageId: string;
  className?: string;
}

export function AudioPlayback({ text, messageId, className = '' }: AudioPlaybackProps) {
  const {
    isSupported,
    isPlaying,
    isPaused,
    currentlyPlayingMessageId,
    togglePlayback,
    stop,
  } = useSpeechSynthesis();

  if (!isSupported) {
    return (
      <button
        disabled
        className={`p-1 rounded opacity-50 cursor-not-allowed ${className}`}
        title="Text-to-speech not supported in this browser"
      >
        <VolumeX size={14} />
      </button>
    );
  }

  const isThisMessagePlaying = currentlyPlayingMessageId === messageId;
  const isActive = isThisMessagePlaying && (isPlaying || isPaused);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isThisMessagePlaying && isPlaying) {
      stop();
    } else {
      togglePlayback(text, messageId);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`p-1 rounded transition-colors hover:bg-white/10 ${
        isActive ? 'text-pink-400' : 'text-current opacity-70 hover:opacity-100'
      } ${className}`}
      title={isActive ? (isPlaying ? 'Stop speaking' : 'Resume speaking') : 'Read aloud'}
    >
      {isActive && isPlaying ? (
        <Pause size={14} fill="currentColor" />
      ) : isActive && isPaused ? (
        <Play size={14} fill="currentColor" />
      ) : (
        <Volume2 size={14} />
      )}
    </button>
  );
}
