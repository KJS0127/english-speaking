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
  expect(body.generationConfig.responseJsonSchema).toBe(RESPONSE_SCHEMA);
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

const mission = {
  titleKo: '라테 주문', goals: ['큰 사이즈 라테 주문하기', '영수증 요청하기'], situationEn: 'The card reader is broken.',
  openingLine: 'Hi!', difficulty: 4, source: 'ai' as const,
};

test('system prompt lists numbered goals and marks achieved ones', () => {
  const p = buildSystemPrompt({ ...base, mission, achieved: [1] });
  expect(p).toContain('The card reader is broken.');
  expect(p).toContain('1. [done] 큰 사이즈 라테 주문하기');
  expect(p).toContain('2. [todo] 영수증 요청하기');
  expect(p).toContain('goalsDone');
  expect(p).toMatch(/never say the learner's line/i);
});

test('system prompt includes the difficulty description', () => {
  const p = buildSystemPrompt({ ...base, mission, achieved: [] });
  expect(p).toContain('Difficulty 4 of 5');
});

test('command detection covers goal and other-scenario commands', () => {
  const p = buildSystemPrompt({ ...base, mission, achieved: [] });
  for (const w of ['목표', 'goal', '다른 상황', 'otherScenario']) expect(p).toContain(w);
});

test('role-play pacing: exchange count, minimum, follow-up questions, one goal per turn', () => {
  const p = buildSystemPrompt({ ...base, mission, achieved: [], exchanges: 1 });
  expect(p).toContain('This is exchange 2; the conversation must last at least 6 exchanges');
  expect(p).toMatch(/follow-up question/i);
  expect(p).toMatch(/at most one goal per turn/i);
  expect(p).toMatch(/do not wrap up/i);
  expect(p).not.toMatch(/wrap up politely now/i);
});

test('wrap-up is allowed only once the minimum is reached', () => {
  const p = buildSystemPrompt({ ...base, mission, achieved: [1], exchanges: 5 });
  expect(p).toContain('This is exchange 6');
  expect(p).toMatch(/wrap up politely now/i);
});
