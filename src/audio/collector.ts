import { createSilenceDetector, type VadOpts } from './vad';
import { rms } from './wav';

/**
 * Feeds raw mic frames through the silence detector and returns one complete
 * utterance (with a few frames of pre-roll so the first syllable is kept).
 */
export function createUtteranceCollector(opts: VadOpts, frameMs: number, prerollFrames: number) {
  const det = createSilenceDetector(opts);
  let preroll: Float32Array[] = [];
  let chunks: Float32Array[] = [];

  const concat = (parts: Float32Array[]) => {
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  };

  const push = (frame: Float32Array): Float32Array | null => {
    const ev = det.push(rms(frame), frameMs);
    if (ev === 'speech-start') {
      chunks = [...preroll, frame];
      preroll = [];
      return null;
    }
    if (ev === 'speech-end') {
      chunks.push(frame);
      const out = concat(chunks);
      chunks = [];
      return out;
    }
    if (det.active()) {
      chunks.push(frame);
      return null;
    }
    chunks = []; // short noise burst discarded by the detector
    if (prerollFrames > 0) {
      preroll.push(frame);
      if (preroll.length > prerollFrames) preroll.shift();
    }
    return null;
  };

  const reset = () => {
    det.reset();
    preroll = [];
    chunks = [];
  };

  return { push, reset, speaking: () => det.active() };
}
