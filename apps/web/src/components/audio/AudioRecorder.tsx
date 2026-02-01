import { Mic, MicOff, Square, X } from 'lucide-react';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';

interface AudioRecorderProps {
  onTranscription: (text: string) => void;
  disabled?: boolean;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function AudioRecorder({ onTranscription, disabled }: AudioRecorderProps) {
  const {
    isSupported,
    isRecording,
    recordingDuration,
    fullTranscription,
    error,
    microphonePermission,
    startRecording,
    stopRecording,
    cancelRecording,
    clearTranscription,
  } = useSpeechRecognition();

  const handleStopAndSend = () => {
    stopRecording();
    if (fullTranscription.trim()) {
      onTranscription(fullTranscription.trim());
    }
    clearTranscription();
  };

  const handleCancel = () => {
    cancelRecording();
  };

  if (!isSupported) {
    return (
      <button
        disabled
        className="w-10 h-10 rounded-full flex items-center justify-center bg-zinc-600 text-zinc-500 cursor-not-allowed"
        title="Speech recognition not supported in this browser"
      >
        <MicOff size={18} />
      </button>
    );
  }

  if (microphonePermission === 'denied') {
    return (
      <button
        disabled
        className="w-10 h-10 rounded-full flex items-center justify-center bg-zinc-600 text-zinc-500 cursor-not-allowed"
        title="Microphone access denied"
      >
        <MicOff size={18} />
      </button>
    );
  }

  if (isRecording) {
    return (
      <div className="flex items-center gap-2">
        {/* Recording indicator and duration */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-600/20 rounded-full border border-red-500/50">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-sm text-red-400 font-mono">
            {formatDuration(recordingDuration)}
          </span>
        </div>

        {/* Cancel button */}
        <button
          onClick={handleCancel}
          className="w-10 h-10 rounded-full flex items-center justify-center bg-zinc-600 hover:bg-zinc-500 text-zinc-300 transition-colors"
          title="Cancel recording"
        >
          <X size={18} />
        </button>

        {/* Stop and send button */}
        <button
          onClick={handleStopAndSend}
          className="w-10 h-10 rounded-full flex items-center justify-center bg-green-600 hover:bg-green-500 text-white transition-colors"
          title="Stop recording and send"
        >
          <Square size={16} fill="currentColor" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={startRecording}
      disabled={disabled}
      className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
        disabled
          ? 'bg-zinc-600 text-zinc-500 cursor-not-allowed'
          : 'bg-zinc-600 hover:bg-zinc-500 text-zinc-300'
      }`}
      title={error || 'Start voice input'}
    >
      <Mic size={18} />
    </button>
  );
}
