import { CONFIG } from '../config';
import { createUtteranceCollector } from './collector';
import { downsample } from './wav';

export interface ListenOpts {
  signal?: AbortSignal;
  /** Resolve with 'idle' after this much silence (0/undefined = never). */
  idleMs?: number;
  /** When aborted, resolve right away with everything recorded so far (manual "done talking"). */
  finish?: AbortSignal;
  /** Pause length that ends an utterance (default CONFIG.vad.silenceMs). */
  silenceMs?: number;
  onSpeechStart?: () => void;
}

export interface Mic {
  /**
   * Resolves with one 16kHz utterance, or 'idle' when idleMs passes with no speech.
   * Frames are only collected while a listen is pending, so app speech is never recorded.
   * Rejects with AbortError when aborted, closed, or when audio stops (e.g. a phone call).
   */
  listen(opts?: ListenOpts): Promise<Float32Array | 'idle'>;
  close(): void;
}

const FRAME = 4096;
const WATCHDOG_MS = 3000;
const abortError = (msg: string) => new DOMException(msg, 'AbortError');

/** Must be called inside a user tap handler (iOS). */
export async function openMic(): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
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
  let fail: ((e: DOMException) => void) | null = null;
  node.onaudioprocess = (e) => handler?.(new Float32Array(e.inputBuffer.getChannelData(0)));

  // iOS moves the context to 'interrupted' on calls/Siri; try to resume, otherwise give up the listen.
  ctx.onstatechange = () => {
    if (ctx.state === 'running' || !fail) return;
    ctx.resume().then(
      () => {
        if ((ctx.state as string) !== 'running') fail?.(abortError('audio interrupted'));
      },
      () => fail?.(abortError('audio interrupted')),
    );
  };

  return {
    listen(opts: ListenOpts = {}) {
      return new Promise<Float32Array | 'idle'>((resolve, reject) => {
        if (opts.signal?.aborted) return reject(abortError('aborted'));
        if (ctx.state !== 'running') void ctx.resume();
        const collector = createUtteranceCollector(
          { ...CONFIG.vad, silenceMs: opts.silenceMs ?? CONFIG.vad.silenceMs },
          frameMs,
          Math.ceil(300 / frameMs),
        );
        const all: Float32Array[] = []; // everything heard in this listen, for the manual finish
        const maxFrames = Math.ceil(CONFIG.vad.maxUtteranceMs / frameMs);
        let quietMs = 0;
        let started = false;
        let lastFrameAt = Date.now();

        const watchdog = setInterval(() => {
          if (Date.now() - lastFrameAt > WATCHDOG_MS) onFail(abortError('no audio frames'));
        }, 1000);
        const cleanup = () => {
          handler = null;
          fail = null;
          clearInterval(watchdog);
          opts.signal?.removeEventListener('abort', onAbort);
          opts.finish?.removeEventListener('abort', onFinish);
        };
        const onFail = (e: DOMException) => {
          cleanup();
          reject(e);
        };
        const onAbort = () => onFail(abortError('aborted'));
        opts.signal?.addEventListener('abort', onAbort);
        const onFinish = () => {
          const samples = all.reduce((n, f) => n + f.length, 0);
          if (samples < ctx.sampleRate * 0.3) return onFail(abortError('nothing recorded'));
          const out = new Float32Array(samples);
          let off = 0;
          for (const f of all) {
            out.set(f, off);
            off += f.length;
          }
          cleanup();
          resolve(downsample(out, ctx.sampleRate, CONFIG.sampleRate));
        };
        if (opts.finish?.aborted) return onFinish();
        opts.finish?.addEventListener('abort', onFinish);
        fail = onFail;

        handler = (frame) => {
          lastFrameAt = Date.now();
          all.push(frame);
          if (all.length > maxFrames) all.shift();
          const out = collector.push(frame);
          if (out) {
            cleanup();
            resolve(downsample(out, ctx.sampleRate, CONFIG.sampleRate));
            return;
          }
          if (collector.speaking()) {
            quietMs = 0;
            if (!started) {
              started = true;
              opts.onSpeechStart?.();
            }
            return;
          }
          started = false;
          quietMs += frameMs;
          if (opts.idleMs && quietMs >= opts.idleMs) {
            cleanup();
            resolve('idle');
          }
        };
      });
    },
    close() {
      fail?.(abortError('mic closed'));
      handler = null;
      node.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
