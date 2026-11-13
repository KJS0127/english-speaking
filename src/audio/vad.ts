export type VadEvent = 'speech-start' | 'speech-end' | null;

export interface VadOpts {
  rmsThreshold: number;
  silenceMs: number;
  minSpeechMs: number;
  maxUtteranceMs: number;
  /** Frames at the start used only to measure background noise (default 0). */
  calibrationFrames?: number;
  /** Consecutive loud frames required before speech starts (default 1). */
  startFrames?: number;
  /** Voice must be this many times the measured noise floor (default 0 = off). */
  floorFactor?: number;
  /** The threshold never goes above this, so normal speech is always heard (default: no cap). */
  maxThreshold?: number;
}

export function createSilenceDetector(opts: VadOpts) {
  const calFrames = opts.calibrationFrames ?? 0;
  const startFrames = Math.max(1, opts.startFrames ?? 1);
  const factor = opts.floorFactor ?? 0;
  const cap = opts.maxThreshold ?? Infinity;

  let calibrated = 0;
  let floor = 0;
  let inSpeech = false;
  let loudRun = 0;
  let pendingMs = 0;
  let speechMs = 0; // loud time inside the current utterance
  let totalMs = 0; // total time since speech-start
  let silentMs = 0;

  const threshold = () => Math.min(cap, Math.max(opts.rmsThreshold, floor * factor));

  const endUtterance = () => {
    inSpeech = false;
    loudRun = 0;
    pendingMs = 0;
    speechMs = 0;
    totalMs = 0;
    silentMs = 0;
  };

  const reset = () => {
    endUtterance();
    calibrated = 0;
    floor = 0;
  };

  const push = (level: number, frameMs: number): VadEvent => {
    if (calibrated < calFrames) {
      // quietest calibration frame = background noise (a tap sound or early speech won't inflate it)
      floor = calibrated === 0 ? level : Math.min(floor, level);
      calibrated++;
      return null;
    }
    const loud = level >= threshold();
    if (!inSpeech) {
      if (!loud) {
        loudRun = 0;
        pendingMs = 0;
        return null;
      }
      loudRun++;
      pendingMs += frameMs;
      if (loudRun < startFrames) return null;
      inSpeech = true;
      speechMs = pendingMs;
      totalMs = pendingMs;
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
      endUtterance();
      return 'speech-end';
    }
    if (silentMs >= opts.silenceMs) {
      const real = speechMs >= opts.minSpeechMs;
      endUtterance();
      return real ? 'speech-end' : null;
    }
    return null;
  };

  return { push, reset, active: () => inSpeech, starting: () => !inSpeech && loudRun > 0 };
}
