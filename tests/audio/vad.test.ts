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

const carOpts = { ...opts, calibrationFrames: 4, startFrames: 2, floorFactor: 2.5 };

test('steady road noise above the base threshold never starts speech', () => {
  const d = createSilenceDetector(carOpts);
  expect(feed(d, 0.03, 200)).not.toContain('speech-start');
});

test('speech louder than the calibrated noise floor is detected', () => {
  const d = createSilenceDetector(carOpts);
  feed(d, 0.03, 4); // calibration
  const ev = feed(d, 0.2, 5);
  expect(ev).toContain('speech-start');
  expect(feed(d, 0.03, 12)[11]).toBe('speech-end');
});

test('isolated loud ticks (turn signal) never start speech', () => {
  const d = createSilenceDetector(carOpts);
  feed(d, 0, 4);
  const ev: VadEvent[] = [];
  for (let i = 0; i < 50; i++) ev.push(d.push(0.3, 100), d.push(0, 100), d.push(0, 100));
  expect(ev).not.toContain('speech-start');
});

test('reset clears state', () => {
  const d = createSilenceDetector(opts);
  feed(d, 0.1, 5);
  d.reset();
  expect(feed(d, 0, 12)).not.toContain('speech-end');
  expect(d.push(0.1, 100)).toBe('speech-start');
});

describe('noise floor robustness', () => {
  const o = { ...opts, calibrationFrames: 4, startFrames: 2, floorFactor: 2.5, maxThreshold: 0.06 };

  test('talking during calibration still gets detected (threshold is capped)', () => {
    const d = createSilenceDetector(o);
    feed(d, 0.2, 4); // user already talking while we calibrate
    expect(feed(d, 0.2, 5)).toContain('speech-start');
    expect(feed(d, 0, 12)[11]).toBe('speech-end');
  });

  test('calibration uses the quietest frame, not the average', () => {
    const d = createSilenceDetector({ ...o, maxThreshold: 1 });
    // one loud blip (tap sound) among quiet frames must not raise the floor
    for (const v of [0.01, 0.3, 0.01, 0.01]) d.push(v, 100);
    expect(feed(d, 0.05, 5)).toContain('speech-start');
  });
});
