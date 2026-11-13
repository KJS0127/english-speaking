import { pickVoice } from '../../src/audio/speaker';

const v = (name: string, lang: string) => ({ name, lang }) as SpeechSynthesisVoice;

test('prefers enhanced/premium voice of the same language', () => {
  const voices = [v('Samantha', 'en-US'), v('Ava (Enhanced)', 'en-US'), v('Yuna', 'ko-KR')];
  expect(pickVoice(voices, 'en-US')?.name).toBe('Ava (Enhanced)');
});

test('recognizes Korean-labelled high quality voices', () => {
  const voices = [v('유나', 'ko-KR'), v('유나(고품질)', 'ko-KR')];
  expect(pickVoice(voices, 'ko-KR')?.name).toBe('유나(고품질)');
});

test('falls back to any voice of the same language', () => {
  expect(pickVoice([v('Daniel', 'en-GB'), v('Samantha', 'en-US')], 'en-US')?.name).toBe('Samantha');
});

test('matches underscore language tags', () => {
  expect(pickVoice([v('Samantha', 'en_US')], 'en-US')?.name).toBe('Samantha');
});

test('returns null when language missing', () => {
  expect(pickVoice([v('Yuna', 'ko-KR')], 'en-US')).toBeNull();
});
