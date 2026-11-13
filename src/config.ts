export const CONFIG = {
  sampleRate: 16000,
  vad: { rmsThreshold: 0.02, silenceMs: 1200, minSpeechMs: 300, maxUtteranceMs: 30000 },
  idlePromptMs: 45000,
  // Free tier + audio input Flash model. Confirm against Gemini docs when deploying.
  model: 'gemini-2.5-flash',
  ttsRate: { normal: 0.95, slow: 0.7 },
  retryDelaysMs: [2000, 5000, 10000], // last value repeats
} as const;
