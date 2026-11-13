import { buildSystemPrompt, buildBody, type TurnRequest } from '../../src/ai/prompt';
import { RESPONSE_SCHEMA } from '../../src/ai/schema';
import { SCENARIOS } from '../../src/scenarios';

const base: TurnRequest = {
  scenario: SCENARIOS[0], mode: 'home', level: 2,
  history: [{ role: 'ai', text: 'Hi there' }, { role: 'user', text: 'Hello' }],
  weakPhrases: [{ original: 'I want coffee', better: "I'd like a coffee" }],
  audioWav: new Uint8Array([1, 2, 3]),
};

test('system prompt includes scenario setup and level', () => {
  const p = buildSystemPrompt(base);
  expect(p).toContain(SCENARIOS[0].setupEn);
  expect(p).toContain('level 2');
});

test('car mode prompt asks for short AI lines', () => {
  expect(buildSystemPrompt({ ...base, mode: 'car' })).toContain('at most 2 short sentences');
  expect(buildSystemPrompt(base)).not.toContain('at most 2 short sentences');
});

test('weak phrases are listed for reuse', () => {
  expect(buildSystemPrompt(base)).toContain("I'd like a coffee");
});

test('command detection covers Korean and English words', () => {
  const p = buildSystemPrompt({ ...base, mode: 'car' });
  for (const w of ['다시', 'repeat', '천천히', '한국어로', '힌트', '다음', '그만']) expect(p).toContain(w);
});

test('buildBody sends audio inline as wav and json schema', () => {
  const body = buildBody(base) as any;
  const last = body.contents[body.contents.length - 1];
  expect(last.role).toBe('user');
  expect(last.parts[last.parts.length - 1]).toEqual({ inlineData: { mimeType: 'audio/wav', data: 'AQID' } });
  expect(body.generationConfig.responseMimeType).toBe('application/json');
  expect(body.generationConfig.responseSchema).toBe(RESPONSE_SCHEMA);
  expect(body.systemInstruction.parts[0].text).toBe(buildSystemPrompt(base));
});

test('history items appear as text parts with roles user/model', () => {
  const body = buildBody(base) as any;
  expect(body.contents[0]).toEqual({ role: 'model', parts: [{ text: 'Hi there' }] });
  expect(body.contents[1]).toEqual({ role: 'user', parts: [{ text: 'Hello' }] });
});

test('typedText is sent as the intended sentence', () => {
  const body = buildBody({ ...base, level: 1, typedText: 'I want a latte' }) as any;
  const last = body.contents[body.contents.length - 1];
  expect(last.parts[0].text).toContain('Intended sentence: I want a latte');
});

test('base64 handles large audio without stack overflow', () => {
  const big = new Uint8Array(500_000).fill(65);
  const body = buildBody({ ...base, audioWav: big }) as any;
  const data: string = body.contents[body.contents.length - 1].parts.at(-1).inlineData.data;
  expect(data.length).toBe(Math.ceil(500_000 / 3) * 4);
});
