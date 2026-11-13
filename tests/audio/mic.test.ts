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
