import { openMic } from '../../src/audio/mic';

class FakeNode {
  onaudioprocess: ((e: any) => void) | null = null;
  connect() {}
  disconnect() {}
}
let node: FakeNode;
let ctx: FakeCtx;
class FakeCtx {
  sampleRate = 16000;
  state: string = 'running';
  onstatechange: (() => void) | null = null;
  destination = {};
  resumeResult = true;
  constructor() {
    ctx = this;
  }
  async resume() {
    if (this.resumeResult) this.state = 'running';
  }
  async close() {}
  createMediaStreamSource() {
    return new FakeNode();
  }
  createScriptProcessor() {
    node = new FakeNode();
    return node;
  }
  createGain() {
    return Object.assign(new FakeNode(), { gain: { value: 1 } });
  }
}
const stopped: number[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  (window as any).AudioContext = FakeCtx;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped.push(1) }] }) },
  });
});
afterEach(() => vi.useRealTimers());

// 4096 samples at 16kHz = 256ms per frame
const frame = (v: number) => node.onaudioprocess!({ inputBuffer: { getChannelData: () => new Float32Array(4096).fill(v) } });

test('resolves idle after idleMs of silence and stops collecting', async () => {
  const mic = await openMic();
  const p = mic.listen({ idleMs: 1000 });
  for (let i = 0; i < 5; i++) {
    frame(0);
    await vi.advanceTimersByTimeAsync(256);
  }
  await expect(p).resolves.toBe('idle');
});

test('close() rejects a pending listen with AbortError and stops the stream', async () => {
  const mic = await openMic();
  const p = mic.listen();
  mic.close();
  await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  expect(stopped.length).toBeGreaterThan(0);
});

test('no audio frames for a few seconds (call interruption) rejects with AbortError', async () => {
  const mic = await openMic();
  const p = mic.listen();
  const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(5000);
  await assertion;
});

test('audio context interrupted and not resumable rejects with AbortError', async () => {
  const mic = await openMic();
  const p = mic.listen();
  const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' });
  ctx.resumeResult = false;
  ctx.state = 'interrupted';
  ctx.onstatechange?.();
  await vi.advanceTimersByTimeAsync(10);
  await assertion;
});

test('abort signal rejects with AbortError', async () => {
  const mic = await openMic();
  const ctrl = new AbortController();
  const p = mic.listen({ signal: ctrl.signal });
  ctrl.abort();
  await expect(p).rejects.toMatchObject({ name: 'AbortError' });
});

test('finish signal resolves with everything recorded so far, even if speech was not detected', async () => {
  const mic = await openMic();
  const finish = new AbortController();
  const p = mic.listen({ finish: finish.signal });
  for (let i = 0; i < 6; i++) {
    frame(0.01); // too quiet for the detector
    await vi.advanceTimersByTimeAsync(256);
  }
  finish.abort();
  const out = await p;
  expect(out).toBeInstanceOf(Float32Array);
  expect((out as Float32Array).length).toBe(6 * 4096);
});

test('finish signal with almost nothing recorded rejects with AbortError', async () => {
  const mic = await openMic();
  const finish = new AbortController();
  const p = mic.listen({ finish: finish.signal });
  finish.abort();
  await expect(p).rejects.toMatchObject({ name: 'AbortError' });
});

test('silenceMs option lengthens the pause allowed inside an utterance', async () => {
  const mic = await openMic();
  let done = false;
  const p = mic.listen({ silenceMs: 2000 }).then((r) => {
    done = true;
    return r;
  });
  for (let i = 0; i < 6; i++) frame(0.3); // speech (after 4 calibration frames)
  for (let i = 0; i < 6; i++) frame(0); // 1.5s pause: not the end yet
  await vi.advanceTimersByTimeAsync(10);
  expect(done).toBe(false);
  for (let i = 0; i < 3; i++) frame(0); // > 2s silence
  await vi.advanceTimersByTimeAsync(10);
  expect(done).toBe(true);
  await p;
});
