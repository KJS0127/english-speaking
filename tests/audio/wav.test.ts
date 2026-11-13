import { rms, downsample, encodeWav } from '../../src/audio/wav';

test('rms of constant 0.5 is 0.5', () => {
  expect(rms(new Float32Array(100).fill(0.5))).toBeCloseTo(0.5);
});

test('rms of empty frame is 0', () => {
  expect(rms(new Float32Array(0))).toBe(0);
});

test('downsample 48000→16000 keeps 1/3 length', () => {
  expect(downsample(new Float32Array(4800), 48000, 16000).length).toBe(1600);
});

test('downsample averages each window', () => {
  const out = downsample(new Float32Array([0.3, 0.6, 0.9, 0, 0, 0]), 48000, 16000);
  expect(out[0]).toBeCloseTo(0.6);
  expect(out[1]).toBeCloseTo(0);
});

test('encodeWav writes RIFF header, rate, and 16-bit samples', () => {
  const out = encodeWav(new Float32Array([0, 1, -1]), 16000);
  const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
  expect(new TextDecoder().decode(out.slice(0, 4))).toBe('RIFF');
  expect(new TextDecoder().decode(out.slice(8, 12))).toBe('WAVE');
  expect(v.getUint32(24, true)).toBe(16000);
  expect(v.getUint16(34, true)).toBe(16);
  expect(out.length).toBe(44 + 3 * 2);
  expect(v.getInt16(46, true)).toBe(32767);
  expect(v.getInt16(48, true)).toBe(-32768);
});

test('encodeWav clips out-of-range samples', () => {
  const out = encodeWav(new Float32Array([2, -2]), 16000);
  const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
  expect(v.getInt16(44, true)).toBe(32767);
  expect(v.getInt16(46, true)).toBe(-32768);
});
