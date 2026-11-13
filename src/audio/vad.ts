export type VadEvent = 'speech-start' | 'speech-end' | null;

export interface VadOpts {
  rmsThreshold: number;
  silenceMs: number;
  minSpeechMs: number;
  maxUtteranceMs: number;
}

export function createSilenceDetector(opts: VadOpts) {
  let inSpeech = false;
  let speechMs = 0; // loud time inside the current utterance
  let totalMs = 0; // total time since speech-start
  let silentMs = 0;

  const reset = () => {
    inSpeech = false;
    speechMs = 0;
    totalMs = 0;
    silentMs = 0;
  };

  const push = (level: number, frameMs: number): VadEvent => {
    const loud = level >= opts.rmsThreshold;
    if (!inSpeech) {
      if (!loud) return null;
      inSpeech = true;
      speechMs = frameMs;
      totalMs = frameMs;
      silentMs = 0;
      return 'speech-start';
    }
    totalMs += frameMs;
    if (loud) {
      speechMs += frameMs;
      silentMs = 0;
    } else {
      silentMs += frameMs;
    }
    if (totalMs >= opts.maxUtteranceMs) {
      reset();
      return 'speech-end';
    }
    if (silentMs >= opts.silenceMs) {
      const real = speechMs >= opts.minSpeechMs;
      reset();
      return real ? 'speech-end' : null;
    }
    return null;
  };

  return { push, reset };
}
