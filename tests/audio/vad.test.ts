import { createSilenceDetector, type VadEvent } from '../../src/audio/vad';

const opts = { rmsThreshold: 0.02, silenceMs: 1200, minSpeechMs: 300, maxUtteranceMs: 30000 };
const feed = (d: ReturnType<typeof createSilenceDetector>, level: number, n: number): VadEvent[] =>
  Array.from({ length: n }, () => d.push(level, 100));

test('emits speech-start then speech-end after 1200ms silence', () => {
  const d = createSilenceDetector(opts);
  const loud = feed(d, 0.1, 5);
  expect(loud[0]).toBe('speech-start');
  expect(loud.slice(1).every((e) => e === null)).toBe(true);
  const quiet = feed(d, 0, 12);
  expect(quiet.slice(0, 11).every((e) => e === null)).toBe(true);
  expect(quiet[11]).toBe('speech-end');
});

test('ignores short noise bursts', () => {
  const d = createSilenceDetector(opts);
  const events = [...feed(d, 0.1, 2), ...feed(d, 0, 12)];
  expect(events).not.toContain('speech-end');
  // after the burst is discarded, a real utterance still works
  expect(feed(d, 0.1, 5)[0]).toBe('speech-start');
  expect(feed(d, 0, 12)[11]).toBe('speech-end');
});

test('forces speech-end at maxUtteranceMs', () => {
  const d = createSilenceDetector(opts);
  const events = feed(d, 0.1, 300);
  expect(events[299]).toBe('speech-end');
  expect(events.slice(1, 299)).not.toContain('speech-end');
});

test('reset clears state', () => {
  const d = createSilenceDetector(opts);
  feed(d, 0.1, 5);
  d.reset();
  expect(feed(d, 0, 12)).not.toContain('speech-end');
  expect(d.push(0.1, 100)).toBe('speech-start');
});
