import { generateMission, buildMissionBody } from '../../src/ai/mission';
import { BadResponseError } from '../../src/ai/errors';
import { resetModelChoice } from '../../src/ai/gemini';
import { SCENARIOS } from '../../src/scenarios';

const scenario = SCENARIOS[0];
const reply = (obj: unknown) =>
  vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 }));
const good = {
  titleKo: '귀리 우유 라테 주문',
  goals: ['큰 사이즈 귀리 우유 라테 주문하기', '매장에서 먹는다고 말하기'],
  situationEn: 'The oat milk is almost sold out.',
  openingLine: 'Hey! What can I make for you?',
};

beforeEach(() => resetModelChoice());

test('mission request includes difficulty, scenario and recent titles to avoid', () => {
  const body = buildMissionBody(scenario, 3, ['지난 미션 A', '지난 미션 B']) as any;
  const sys: string = body.systemInstruction.parts[0].text;
  expect(sys).toContain(scenario.setupEn);
  expect(sys).toContain('difficulty 3');
  expect(sys).toContain('지난 미션 A');
  expect(sys).toContain('2 to 3 goals');
  expect(body.generationConfig.responseMimeType).toBe('application/json');
  expect(body.generationConfig.responseJsonSchema.type).toBe('object');
});

test('generateMission returns an AI mission', async () => {
  const m = await generateMission(scenario, 2, [], 'K', reply(good));
  expect(m).toEqual({ ...good, difficulty: 2, source: 'ai' });
});

test('generateMission rejects bad goal counts', async () => {
  await expect(generateMission(scenario, 2, [], 'K', reply({ ...good, goals: [] }))).rejects.toBeInstanceOf(BadResponseError);
  await expect(
    generateMission(scenario, 2, [], 'K', reply({ ...good, goals: ['a', 'b', 'c', 'd', 'e'] })),
  ).rejects.toBeInstanceOf(BadResponseError);
});

test('generateMission rejects missing fields', async () => {
  await expect(generateMission(scenario, 2, [], 'K', reply({ ...good, openingLine: '' }))).rejects.toBeInstanceOf(BadResponseError);
  await expect(generateMission(scenario, 2, [], 'K', reply({ goals: ['a'] }))).rejects.toBeInstanceOf(BadResponseError);
});

test('mission prompt asks for multi-exchange goals and hidden details', () => {
  const sys: string = (buildMissionBody(scenario, 3, []) as any).systemInstruction.parts[0].text;
  expect(sys).toMatch(/several exchanges/i);
  expect(sys).toMatch(/hidden detail/i);
  expect(sys).toMatch(/not .*single sentence/i);
});
