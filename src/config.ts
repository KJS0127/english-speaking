export const CONFIG = {
  sampleRate: 16000,
  vad: {
    rmsThreshold: 0.02, // minimum level counted as voice
    silenceMs: 1200,
    minSpeechMs: 300,
    maxUtteranceMs: 30000,
    calibrationFrames: 4, // first frames of each listen measure the noise floor
    startFrames: 2, // consecutive loud frames needed to start (ignores ticks/bumps)
    floorFactor: 2.5, // voice must be this many times louder than the noise floor
  },
  idlePromptMs: 45000,
  // Free-tier models that accept audio input, tried in order (the first that works is remembered).
  // gemini-2.5-flash was deprecated in 2026; check the Gemini deprecations page before changing.
  models: ['gemini-3.5-flash-lite', 'gemini-2.5-flash-lite'],
  requestTimeoutMs: 20000,
  ttsRate: { normal: 0.95, slow: 0.7 },
  retryDelaysMs: [2000, 5000, 10000], // last value repeats
  maxRateLimitRetries: 6,
  maxConsecutiveBadResponses: 3,
} as const;
