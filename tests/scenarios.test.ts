import { SCENARIOS, nextScenario, findScenario } from '../src/scenarios';

test('each category has at least 4 scenarios; free talk exists', () => {
  for (const c of ['daily', 'travel', 'business'] as const) {
    expect(SCENARIOS.filter((s) => s.category === c).length).toBeGreaterThanOrEqual(4);
  }
  expect(SCENARIOS.some((s) => s.category === 'free')).toBe(true);
});

test('business includes email-to-meeting practice', () => {
  expect(SCENARIOS.some((s) => s.category === 'business' && s.titleKo.includes('이메일'))).toBe(true);
});

test('ids are unique', () => {
  expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
});

test('nextScenario stays in category and wraps', () => {
  const travel = SCENARIOS.filter((s) => s.category === 'travel');
  expect(nextScenario(travel[0])).toBe(travel[1]);
  expect(nextScenario(travel[travel.length - 1])).toBe(travel[0]);
});

test('findScenario returns undefined for unknown id', () => {
  expect(findScenario(SCENARIOS[0].id)).toBe(SCENARIOS[0]);
  expect(findScenario('nope')).toBeUndefined();
});
