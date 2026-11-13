import 'fake-indexeddb/auto';
import { FALLBACK_MISSIONS, fallbackMission, goalCountRange, minExchanges } from '../../src/missions';
import { evaluate } from '../../src/session/difficulty';
import { startMission, finishMission, type RunnerDeps } from '../../src/session/missionRunner';
import { SCENARIOS } from '../../src/scenarios';
import { openDb } from '../../src/store/db';

const P = (over = {}) => ({ scenarioId: 's', level: 2, failStreak: 0, recentMissions: [], ...over });

describe('fallback missions', () => {
  test('every scenario has 1-2 fallback missions with 1-2 goals', () => {
    for (const s of SCENARIOS) {
      const list = FALLBACK_MISSIONS[s.id];
      expect(list?.length, s.id).toBeGreaterThanOrEqual(1);
      expect(list.length).toBeLessThanOrEqual(2);
      for (const m of list) {
        expect(m.goals.length).toBeGreaterThanOrEqual(1);
        expect(m.goals.length).toBeLessThanOrEqual(2);
      }
    }
  });

  test('fallback prefers a title not used recently and uses the scenario opening line', () => {
    const s = SCENARIOS.find((x) => FALLBACK_MISSIONS[x.id].length === 2)!;
    const [a, b] = FALLBACK_MISSIONS[s.id];
    const m = fallbackMission(s, 3, [a.titleKo]);
    expect(m.titleKo).toBe(b.titleKo);
    expect(m).toMatchObject({ openingLine: s.openingLine, difficulty: 3, source: 'fallback' });
  });

  test('goal count range per difficulty', () => {
    expect(goalCountRange(1)).toEqual([1, 2]);
    expect(goalCountRange(5)).toEqual([3, 4]);
  });
});

describe('evaluate', () => {
  test('all goals with few corrections goes up', () => {
    expect(evaluate(P({ failStreak: 1 }), { achieved: true, userTurns: 3, corrections: 1 })).toEqual({
      progress: P({ level: 3, failStreak: 0 }), change: 'up', counted: true,
    });
  });
  test('all goals with many corrections stays and resets fail streak', () => {
    expect(evaluate(P({ failStreak: 1 }), { achieved: true, userTurns: 3, corrections: 2 })).toEqual({
      progress: P({ failStreak: 0 }), change: null, counted: true,
    });
  });
  test('first failure adds to streak, second goes down', () => {
    const one = evaluate(P(), { achieved: false, userTurns: 4, corrections: 0 });
    expect(one).toEqual({ progress: P({ failStreak: 1 }), change: null, counted: true });
    expect(evaluate(one.progress, { achieved: false, userTurns: 2, corrections: 0 })).toEqual({
      progress: P({ level: 1, failStreak: 0 }), change: 'down', counted: true,
    });
  });
  test('level stays within 1..5', () => {
    expect(evaluate(P({ level: 5 }), { achieved: true, userTurns: 1, corrections: 0 }).progress.level).toBe(5);
    expect(evaluate(P({ level: 1, failStreak: 1 }), { achieved: false, userTurns: 3, corrections: 0 }).progress.level).toBe(1);
    expect(evaluate(P({ level: 5 }), { achieved: true, userTurns: 1, corrections: 0 }).change).toBeNull();
  });
  test('failure with fewer than 2 user turns is not counted', () => {
    expect(evaluate(P(), { achieved: false, userTurns: 1, corrections: 0 })).toEqual({ progress: P(), change: null, counted: false });
  });
  test('success in a single turn is counted', () => {
    expect(evaluate(P(), { achieved: true, userTurns: 1, corrections: 0 }).change).toBe('up');
  });
});

describe('mission runner', () => {
  let n = 0;
  const scenario = SCENARIOS[0];
  const aiMission = { titleKo: 'AI 미션', goals: ['g'], situationEn: 's', openingLine: 'Hi', difficulty: 1, source: 'ai' as const };

  async function deps(generate: RunnerDeps['generate']) {
    const db = await openDb(`runner-${++n}`);
    return { db, generate };
  }

  test('startMission asks AI at the saved level and records the title', async () => {
    const d = await deps(vi.fn(async () => ({ ...aiMission, difficulty: 3 })));
    await d.db.saveProgress(P({ scenarioId: scenario.id, level: 3, recentMissions: ['old'] }));
    const m = await startMission(d, scenario);
    expect(d.generate).toHaveBeenCalledWith(scenario, 3, ['old'], undefined);
    expect(m.titleKo).toBe('AI 미션');
    expect((await d.db.getProgress(scenario.id)).recentMissions).toEqual(['old', 'AI 미션']);
  });

  test('startMission falls back on any error', async () => {
    const d = await deps(vi.fn(async () => {
      throw new Error('offline');
    }));
    const m = await startMission(d, scenario);
    expect(m.source).toBe('fallback');
    expect(FALLBACK_MISSIONS[scenario.id].map((x) => x.titleKo)).toContain(m.titleKo);
  });

  test('recent titles keep last 5', async () => {
    const d = await deps(vi.fn(async () => aiMission));
    await d.db.saveProgress(P({ scenarioId: scenario.id, recentMissions: ['1', '2', '3', '4', '5'] }));
    await startMission(d, scenario);
    expect((await d.db.getProgress(scenario.id)).recentMissions).toEqual(['2', '3', '4', '5', 'AI 미션']);
  });

  test('finishMission saves new level and returns change', async () => {
    const d = await deps(vi.fn());
    expect(await finishMission(d, scenario.id, { achieved: true, userTurns: 2, corrections: 0 })).toBe('up');
    expect((await d.db.getProgress(scenario.id)).level).toBe(2);
  });
});

test('minimum exchanges per difficulty', () => {
  expect([1, 2, 3, 4, 5].map(minExchanges)).toEqual([3, 4, 5, 6, 7]);
});
