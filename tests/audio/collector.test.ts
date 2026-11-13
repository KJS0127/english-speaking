import { createUtteranceCollector } from '../../src/audio/collector';

const opts = { rmsThreshold: 0.02, silenceMs: 300, minSpeechMs: 200, maxUtteranceMs: 30000 };
const frame = (val: number, n = 10) => new Float32Array(n).fill(val);

test('returns utterance including pre-roll frames once speech ends', () => {
  const c = createUtteranceCollector(opts, 100, 2); // 100ms frames, 2 pre-roll frames
  expect(c.push(frame(0.001))).toBeNull(); // pre-roll A
  expect(c.push(frame(0.002))).toBeNull(); // pre-roll B
  expect(c.push(frame(0.5))).toBeNull(); // speech-start
  expect(c.push(frame(0.5))).toBeNull();
  expect(c.push(frame(0))).toBeNull();
  expect(c.push(frame(0))).toBeNull();
  const out = c.push(frame(0)); // 300ms silence → end
  expect(out).not.toBeNull();
  expect(out!.length).toBe(7 * 10); // 2 pre-roll + 2 speech + 3 silence
  expect(out![0]).toBeCloseTo(0.001);
  expect(out![20]).toBeCloseTo(0.5);
});

test('discards a short noise burst', () => {
  const c = createUtteranceCollector(opts, 100, 0);
  c.push(frame(0.5)); // 100ms < 200ms
  for (let i = 0; i < 5; i++) expect(c.push(frame(0))).toBeNull();
  expect(c.speaking()).toBe(false);
});

test('reports speaking state', () => {
  const c = createUtteranceCollector(opts, 100, 0);
  expect(c.speaking()).toBe(false);
  c.push(frame(0.5));
  expect(c.speaking()).toBe(true);
});
