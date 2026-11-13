import { CONFIG } from '../config';
import { createUtteranceCollector } from './collector';
import { downsample } from './wav';

export interface ListenOpts {
  signal?: AbortSignal;
  idleMs?: number;
  onIdle?: () => void;
  onSpeechStart?: () => void;
}

export interface Mic {
  /** Resolves with one 16kHz utterance. Rejects with AbortError when aborted. */
  listen(opts?: ListenOpts): Promise<Float32Array>;
  close(): void;
}

const FRAME = 4096;

/** Must be called inside a user tap handler (iOS). */
export async function openMic(): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const AC: typeof AudioContext = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  const ctx = new AC();
  await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessorNode is deprecated but is the most reliable option on iOS Safari.
  const node = ctx.createScriptProcessor(FRAME, 1, 1);
  const sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(node);
  node.connect(sink);
  sink.connect(ctx.destination);

  const frameMs = (FRAME / ctx.sampleRate) * 1000;
  let handler: ((frame: Float32Array) => void) | null = null;
  node.onaudioprocess = (e) => handler?.(new Float32Array(e.inputBuffer.getChannelData(0)));

  return {
    listen(opts: ListenOpts = {}) {
      return new Promise<Float32Array>((resolve, reject) => {
        if (opts.signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
        if (ctx.state === 'suspended') void ctx.resume();
        const collector = createUtteranceCollector(CONFIG.vad, frameMs, Math.ceil(300 / frameMs));
        let quietMs = 0;
        let started = false;
        const finish = () => {
          handler = null;
          opts.signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
          finish();
          reject(new DOMException('aborted', 'AbortError'));
        };
        opts.signal?.addEventListener('abort', onAbort);
        handler = (frame) => {
          const out = collector.push(frame);
          if (collector.speaking() && !started) {
            started = true;
            quietMs = 0;
            opts.onSpeechStart?.();
          }
          if (!collector.speaking() && !out) {
            started = false;
            quietMs += frameMs;
            if (opts.idleMs && quietMs >= opts.idleMs) {
              quietMs = 0;
              opts.onIdle?.();
            }
          }
          if (out) {
            finish();
            resolve(downsample(out, ctx.sampleRate, CONFIG.sampleRate));
          }
        };
      });
    },
    close() {
      handler = null;
      node.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
