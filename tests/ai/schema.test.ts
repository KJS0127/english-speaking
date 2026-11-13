import { parseTurnResult, RESPONSE_SCHEMA } from '../../src/ai/schema';
import { BadResponseError } from '../../src/ai/errors';

const full = {
  transcript: 'I want coffee',
  command: 'none',
  aiLine: 'Sure, what size?',
  aiLineKo: '네, 어떤 사이즈로 드릴까요?',
  suggestedReply: 'A large one, please.',
  correction: { original: 'I want coffee', better: "I'd like a coffee, please.", why: '더 공손해요' },
  pronunciation: 'coffee의 f 발음이 p처럼 들려요',
};

test('parseTurnResult accepts full object', () => {
  expect(parseTurnResult(full)).toEqual(full);
});

test('parseTurnResult fills defaults', () => {
  expect(parseTurnResult({ transcript: 'hi', aiLine: 'Hello' })).toEqual({
    transcript: 'hi', command: 'none', aiLine: 'Hello', aiLineKo: '', suggestedReply: '',
    correction: null, pronunciation: null,
  });
});

test('parseTurnResult rejects missing aiLine', () => {
  expect(() => parseTurnResult({ transcript: 'hi' })).toThrow(BadResponseError);
});

test('parseTurnResult rejects non-object', () => {
  expect(() => parseTurnResult('nope')).toThrow(BadResponseError);
  expect(() => parseTurnResult(null)).toThrow(BadResponseError);
});

test('parseTurnResult maps unknown command to none', () => {
  expect(parseTurnResult({ ...full, command: 'dance' }).command).toBe('none');
});

test('parseTurnResult drops incomplete correction', () => {
  expect(parseTurnResult({ ...full, correction: { better: 'x' } }).correction).toBeNull();
});

test('missing transcript becomes empty string', () => {
  expect(parseTurnResult({ aiLine: 'Hello' }).transcript).toBe('');
});

test('schema lists all fields as properties', () => {
  const props = Object.keys((RESPONSE_SCHEMA as { properties: object }).properties);
  expect(props.sort()).toEqual(
    ['aiLine', 'aiLineKo', 'command', 'correction', 'pronunciation', 'suggestedReply', 'transcript'].sort(),
  );
});
