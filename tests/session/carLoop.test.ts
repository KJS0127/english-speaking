import { runCarLoop, createLoopState, closeMissionForQuit, type LoopDeps } from '../../src/session/carLoop';
import type { Mission } from '../../src/missions';
import type { Scenario } from '../../src/scenarios';
import type { LevelChange, Outcome } from '../../src/session/difficulty';
import { KO, EN_RETRY } from '../../src/session/phrases';
import { SCENARIOS, nextScenario } from '../../src/scenarios';
import { CONFIG } from '../../src/config';
import { AuthError, BadResponseError, FatalApiError, NetworkError, QuotaError, RateLimitError } from '../../src/ai/errors';
import type { TurnResult } from '../../src/ai/schema';
import type { TurnRequest } from '../../src/ai/prompt';

const scenario = SCENARIOS.find((s) => s.category === 'travel')!;
const res = (over: Partial<TurnResult> = {}): TurnResult => ({
  transcript: 'I have a reservation', command: 'none', aiLine: 'Great, your name please?', aiLineKo: '좋아요, 성함이요?',
  suggestedReply: 'My name is Kim.', correction: null, pronunciation: null, goalsDone: [], ...over,
});

type Step = TurnResult | Error;

const missionFor = (s: Scenario, goals = ['목표 하나', '목표 둘'], difficulty = 1): Mission => ({
  titleKo: `미션 ${s.id}`, goals, situationEn: 'twist', openingLine: s.openingLine, difficulty, source: 'ai',
});

function setup(steps: Step[], opts: { idleCalls?: number; utterances?: number; goals?: string[]; change?: LevelChange; difficulty?: number } = {}) {
  const ctrl = new AbortController();
  const all: { text: string; lang: string; rate: number }[] = [];
  // `spoken` leaves out the mission-intro announcement so older tests keep their indexes
  const spoken: { text: string; lang: string; rate: number }[] = [];
  const sessions: any[] = [];
  const updates: any[] = [];
  const finished: { scenarioId: string; o: Outcome }[] = [];
  const missionsStarted: Scenario[] = [];
  const sent: TurnRequest[] = [];
  const turns: any[] = [];
  const ended: string[] = [];
  const sleeps: number[] = [];
  const listenIdleMs: number[] = [];
  let listens = opts.utterances ?? steps.length;
  let idle = opts.idleCalls ?? 0;
  const queue = [...steps];
  let id = 0;
  const deps: LoopDeps = {
    async listen({ idleMs }) {
      listenIdleMs.push(idleMs);
      if (idle > 0) {
        idle--;
        return 'idle';
      }
      if (listens-- <= 0) {
        ctrl.abort();
        throw new DOMException('aborted', 'AbortError');
      }
      return new Float32Array([0.1, 0.2]);
    },
    async send(req) {
      sent.push(req);
      const next = queue.shift();
      if (!next) throw new Error('no more steps');
      if (next instanceof Error) throw next;
      return next;
    },
    async speak(text, o) {
      const item = { text, lang: o.lang, rate: o.rate };
      all.push(item);
      if (!text.startsWith(KO.goalIntro)) spoken.push(item);
    },
    async startMission(s) {
      missionsStarted.push(s);
      return missionFor(s, opts.goals, opts.difficulty);
    },
    async finishMission(scenarioId, o) {
      finished.push({ scenarioId, o });
      return opts.change ?? null;
    },
    db: {
      async addTurn(t) {
        turns.push(t);
      },
      async endSession(sid) {
        ended.push(sid);
      },
      async startSession(s) {
        sessions.push(s);
      },
      async updateSession(sid, patch) {
        updates.push({ sid, ...patch });
      },
    },
    now: () => 1000,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    newId: () => `id${id++}`,
  };
  const run = () => runCarLoop(deps, { scenario, weakPhrases: [{ original: 'a', better: 'b' }] }, ctrl.signal);
  return { run, spoken, all, sent, turns, ended, sleeps, ctrl, listenIdleMs, deps, sessions, updates, finished, missionsStarted };
}

const texts = (s: { text: string }[]) => s.map((x) => x.text);

test('speaks opening line first in en-US normal rate', async () => {
  const t = setup([]);
  await t.run();
  expect(t.spoken[0]).toEqual({ text: scenario.openingLine, lang: 'en-US', rate: CONFIG.ttsRate.normal });
});

test('normal turn: sends once, speaks aiLine, saves turn without audio', async () => {
  const t = setup([res({ correction: { original: 'x', better: 'y', why: 'z' } })]);
  await t.run();
  expect(t.sent).toHaveLength(1);
  expect(t.sent[0].mode).toBe('car');
  expect(t.sent[0].level).toBe(3);
  expect(t.sent[0].weakPhrases).toEqual([{ original: 'a', better: 'b' }]);
  expect(texts(t.spoken)).toEqual([scenario.openingLine, 'Great, your name please?']);
  expect(t.turns).toHaveLength(1);
  expect(t.turns[0]).toEqual({
    id: 'id1', sessionId: 'id0', idx: 0, at: 1000, transcript: 'I have a reservation', aiLine: 'Great, your name please?',
    correction: { original: 'x', better: 'y', why: 'z' }, pronunciation: null,
  });
});

test('car mode does not speak corrections', async () => {
  const t = setup([res({ correction: { original: 'x', better: 'BETTER-PHRASE', why: 'WHY' }, pronunciation: 'PRON' })]);
  await t.run();
  expect(texts(t.spoken).join(' ')).not.toMatch(/BETTER-PHRASE|WHY|PRON/);
});

test('repeat speaks last aiLine again and does not save turn', async () => {
  const t = setup([res(), res({ command: 'repeat', transcript: '다시', aiLine: 'OK' })]);
  await t.run();
  expect(texts(t.spoken)).toEqual([scenario.openingLine, 'Great, your name please?', 'Great, your name please?']);
  expect(t.turns).toHaveLength(1);
  expect(t.sent).toHaveLength(2);
});

test('repeat before any turn repeats the opening line', async () => {
  const t = setup([res({ command: 'repeat', aiLine: 'OK' })]);
  await t.run();
  expect(texts(t.spoken)).toEqual([scenario.openingLine, scenario.openingLine]);
});

test('slower repeats last line at slow rate and keeps slow rate after', async () => {
  const t = setup([res(), res({ command: 'slower', aiLine: 'OK' }), res({ aiLine: 'Next line' })]);
  await t.run();
  expect(t.spoken[2]).toEqual({ text: 'Great, your name please?', lang: 'en-US', rate: CONFIG.ttsRate.slow });
  expect(t.spoken[3]).toEqual({ text: 'Next line', lang: 'en-US', rate: CONFIG.ttsRate.slow });
});

test('korean speaks last aiLineKo in ko-KR', async () => {
  const t = setup([res(), res({ command: 'korean', aiLine: 'OK' })]);
  await t.run();
  expect(t.spoken[2]).toMatchObject({ text: '좋아요, 성함이요?', lang: 'ko-KR' });
});

test('hint speaks KO.hintIntro then suggestedReply', async () => {
  const t = setup([res(), res({ command: 'hint', aiLine: 'OK', suggestedReply: 'IGNORED' })]);
  await t.run();
  expect(t.spoken[2]).toMatchObject({ text: KO.hintIntro, lang: 'ko-KR' });
  expect(t.spoken[3]).toMatchObject({ text: 'My name is Kim.', lang: 'en-US' });
});

test('otherScenario moves to the next scenario with a new mission and resets history', async () => {
  const t = setup([res(), res({ command: 'otherScenario', aiLine: 'OK' }), res({ aiLine: 'Hello again' })]);
  await t.run();
  const nxt = nextScenario(scenario);
  expect(t.spoken[2]).toMatchObject({ text: KO.otherScenario, lang: 'ko-KR' });
  expect(t.spoken[3]).toMatchObject({ text: nxt.openingLine, lang: 'en-US' });
  expect(t.sent[2].scenario).toBe(nxt);
  expect(t.sent[2].history).toEqual([{ role: 'ai', text: nxt.openingLine }]);
  expect(t.finished).toEqual([{ scenarioId: scenario.id, o: { achieved: false, userTurns: 1, corrections: 0 } }]);
  expect(t.sessions.map((s) => s.scenarioId)).toEqual([scenario.id, nxt.id]);
});

test('speaks the goals in Korean before the opening line and starts a session with mission fields', async () => {
  const t = setup([]);
  await t.run();
  expect(t.all[0].lang).toBe('ko-KR');
  expect(t.all[0].text).toBe(`${KO.goalIntro} 1번, 목표 하나. 2번, 목표 둘.`);
  expect(t.all[1].text).toBe(scenario.openingLine);
  expect(t.sessions[0]).toMatchObject({
    scenarioId: scenario.id, mode: 'car', missionTitle: `미션 ${scenario.id}`, goals: ['목표 하나', '목표 둘'], difficulty: 1,
  });
});

test('sends the mission and achieved goals with each turn', async () => {
  const t = setup([res({ goalsDone: [1] }), res()]);
  await t.run();
  expect(t.sent[0].mission!.titleKo).toBe(`미션 ${scenario.id}`);
  expect(t.sent[0].achieved).toEqual([]);
  expect(t.sent[1].achieved).toEqual([1]);
});

test('goal progress announces one achieved goal after the AI line', async () => {
  const t = setup([res({ goalsDone: [2] })]);
  await t.run();
  expect(texts(t.spoken).slice(-2)).toEqual(['Great, your name please?', KO.goalOne]);
});

test('duplicate or out-of-range goal numbers count once', async () => {
  const t = setup([res({ goalsDone: [1, 7] }), res({ goalsDone: [1] })]);
  await t.run();
  expect(texts(t.spoken).filter((x) => x === KO.goalOne)).toHaveLength(1);
  expect(t.finished).toEqual([]);
});

test('all goals: congratulate, evaluate as achieved, end session, start a new mission in the same scenario', async () => {
  const t = setup([res({ goalsDone: [1] }), res({ goalsDone: [2], correction: { original: 'a', better: 'b', why: '' } }), res()], {
    change: 'up',
  });
  await t.run();
  expect(texts(t.spoken)).toContain(KO.goalAll);
  expect(texts(t.spoken)).toContain(KO.levelUp(2));
  expect(t.finished).toEqual([{ scenarioId: scenario.id, o: { achieved: true, userTurns: 3, corrections: 1 } }]);
  expect(t.updates).toContainEqual({ sid: t.sessions[0].id, achieved: true });
  expect(t.ended).toContain(t.sessions[0].id);
  expect(t.missionsStarted).toEqual([scenario, scenario]);
  expect(t.sessions).toHaveLength(2);
  expect(t.all.filter((x) => x.text.startsWith(KO.goalIntro))).toHaveLength(2);
});

test('level down is announced', async () => {
  const t = setup([res(), res({ command: 'next', aiLine: 'OK' })], { change: 'down' });
  await t.run();
  expect(texts(t.spoken)).toContain(KO.levelDown(1));
});

test('goal command reads the remaining goals in Korean without saving a turn', async () => {
  const t = setup([res({ goalsDone: [1] }), res({ command: 'goal', aiLine: 'OK' })]);
  await t.run();
  expect(t.spoken.at(-1)).toMatchObject({ text: `${KO.goalsLeft} 2번, 목표 둘.`, lang: 'ko-KR' });
  expect(t.turns).toHaveLength(1);
});

test('next abandons the mission (evaluated as not achieved) and starts a new mission in the same scenario', async () => {
  const t = setup([res(), res({ transcript: 'x', aiLine: 'y' }), res({ command: 'next', aiLine: 'OK' })]);
  await t.run();
  expect(t.spoken.find((x) => x.text === KO.newMission)).toBeDefined();
  expect(t.finished).toEqual([{ scenarioId: scenario.id, o: { achieved: false, userTurns: 2, corrections: 0 } }]);
  expect(t.missionsStarted).toEqual([scenario, scenario]);
  expect(t.ended).toContain(t.sessions[0].id);
});

test('command and empty turns are not counted as user turns', async () => {
  const t = setup([res(), res({ command: 'repeat', aiLine: 'OK' }), res({ transcript: ' ' }), res({ command: 'stop', aiLine: 'OK' })]);
  await t.run();
  expect(t.finished[0].o.userTurns).toBe(1);
});

test('stop evaluates the mission', async () => {
  const t = setup([res(), res({ command: 'stop', aiLine: 'OK' })]);
  expect(await t.run()).toBe('stopped');
  expect(t.finished).toHaveLength(1);
});

test('quota during a turn does not evaluate the mission', async () => {
  const t = setup([res(), new QuotaError('x')]);
  expect(await t.run()).toBe('quota');
  expect(t.finished).toEqual([]);
  expect(t.ended).toEqual([t.sessions[0].id]);
});

test('closeMissionForQuit evaluates and ends the current mission session', async () => {
  const t = setup([res(), res({ transcript: 'x', aiLine: 'y' })]);
  const state = createLoopState(scenario, CONFIG.ttsRate.normal);
  await runCarLoop(t.deps, { scenario, weakPhrases: [], state }, t.ctrl.signal);
  await closeMissionForQuit(t.deps, state);
  expect(t.finished).toEqual([{ scenarioId: scenario.id, o: { achieved: false, userTurns: 2, corrections: 0 } }]);
  expect(t.ended).toEqual([t.sessions[0].id]);
  await closeMissionForQuit(t.deps, state); // second call is a no-op
  expect(t.finished).toHaveLength(1);
});

test('stop speaks KO.stop, ends session, returns stopped', async () => {
  const t = setup([res({ command: 'stop', aiLine: 'OK' })]);
  expect(await t.run()).toBe('stopped');
  expect(t.spoken.at(-1)).toMatchObject({ text: KO.stop, lang: 'ko-KR' });
  expect(t.ended).toEqual([t.sessions[0].id]);
});

test('empty transcript is ignored', async () => {
  const t = setup([res({ transcript: '   ', aiLine: 'Hmm?' })]);
  await t.run();
  expect(texts(t.spoken)).toEqual([scenario.openingLine]);
  expect(t.turns).toHaveLength(0);
});

test('idle prompt is spoken once per silent stretch, with the mic stopped', async () => {
  const t = setup([res()], { idleCalls: 2 });
  await t.run();
  expect(texts(t.spoken).filter((x) => x === KO.idle)).toHaveLength(1);
  // first listen waits for idle; after prompting, keep listening without another idle timeout
  expect(t.listenIdleMs[0]).toBe(CONFIG.idlePromptMs);
  expect(t.listenIdleMs[1]).toBe(0);
  expect(t.listenIdleMs[2]).toBe(0);
  // after a real turn the idle timer is armed again
  expect(t.listenIdleMs[3]).toBe(CONFIG.idlePromptMs);
});

test('model gone (FatalApiError) ends loop with spoken notice', async () => {
  const t = setup([new FatalApiError('404')]);
  expect(await t.run()).toBe('error');
  expect(t.spoken.at(-1)).toMatchObject({ text: KO.fatal, lang: 'ko-KR' });
  expect(t.ended).toEqual([t.sessions[0].id]);
});

test('repeated bad responses end the loop instead of apologising forever', async () => {
  const bad = () => new BadResponseError('x');
  const t = setup([bad(), bad(), bad(), res()]);
  expect(await t.run()).toBe('error');
  expect(texts(t.spoken).filter((x) => x === EN_RETRY)).toHaveLength(2);
  expect(t.spoken.at(-1)).toMatchObject({ text: KO.badRepeated, lang: 'ko-KR' });
});

test('a good reply resets the bad-response counter', async () => {
  const bad = () => new BadResponseError('x');
  const t = setup([bad(), bad(), res(), bad(), bad(), res()]);
  await t.run();
  expect(t.ended).toEqual([]);
});

test('per-minute rate limit waits silently and resends the same audio', async () => {
  const t = setup([new RateLimitError('x', 7000), res()], { utterances: 1 });
  await t.run();
  expect(t.sleeps).toEqual([7000]);
  expect(t.sent).toHaveLength(2);
  expect(texts(t.spoken)).not.toContain(KO.offline);
  expect(texts(t.spoken).at(-1)).toBe('Great, your name please?');
});

test('rate limit that never clears ends as quota', async () => {
  const errs = Array.from({ length: CONFIG.maxRateLimitRetries + 1 }, () => new RateLimitError('x'));
  const t = setup(errs, { utterances: 1 });
  expect(await t.run()).toBe('quota');
  expect(t.sleeps.every((ms) => ms === 10000)).toBe(true);
});

test('send receives the loop abort signal', async () => {
  const t = setup([res()]);
  const send = vi.spyOn(t.deps, 'send');
  await t.run();
  expect(send.mock.calls[0][1]).toBe(t.ctrl.signal);
});

test('uses the configured voice rate', async () => {
  const t = setup([]);
  await runCarLoop(t.deps, { scenario, weakPhrases: [], rate: 0.8 }, t.ctrl.signal);
  expect(t.spoken[0].rate).toBe(0.8);
});

test('resuming with the same state continues instead of restarting', async () => {
  const state = createLoopState(scenario, CONFIG.ttsRate.normal);
  const a = setup([res(), res({ command: 'otherScenario', aiLine: 'OK' })]);
  await runCarLoop(a.deps, { scenario, weakPhrases: [], state }, a.ctrl.signal);
  const b = setup([res({ transcript: 'Hi', aiLine: 'Hello' })]);
  await runCarLoop(b.deps, { scenario, weakPhrases: [], state }, b.ctrl.signal);
  const nxt = nextScenario(scenario);
  // no mission intro or opening line again; same (next) scenario; history kept; idx continues
  expect(texts(b.all)).toEqual(['Hello']);
  expect(b.missionsStarted).toEqual([]);
  expect(b.sent[0].scenario).toBe(nxt);
  expect(b.sent[0].history).toEqual([{ role: 'ai', text: nxt.openingLine }]);
  expect(b.turns[0].idx).toBe(0);
  expect(b.turns[0].sessionId).toBe(a.sessions[1].id);
});

test('bad response asks to repeat', async () => {
  const t = setup([new BadResponseError('x'), res()]);
  await t.run();
  expect(t.spoken[1]).toMatchObject({ text: EN_RETRY, lang: 'en-US' });
  expect(t.spoken[2].text).toBe('Great, your name please?');
});

test('network error retries and resumes', async () => {
  const t = setup([new NetworkError('x'), new NetworkError('x'), res()], { utterances: 1 });
  await t.run();
  expect(texts(t.spoken).filter((x) => x === KO.offline)).toHaveLength(1);
  expect(texts(t.spoken).filter((x) => x === KO.online)).toHaveLength(1);
  expect(t.sleeps).toEqual([2000, 5000]);
  expect(t.sent).toHaveLength(3);
  expect(t.sent[2].audioWav).toEqual(t.sent[0].audioWav);
  expect(texts(t.spoken).at(-1)).toBe('Great, your name please?');
});

test('network retry keeps using the last delay', async () => {
  const errs = Array.from({ length: 5 }, () => new NetworkError('x'));
  const t = setup([...errs, res()], { utterances: 1 });
  await t.run();
  expect(t.sleeps).toEqual([2000, 5000, 10000, 10000, 10000]);
});

test('quota error ends loop', async () => {
  const t = setup([new QuotaError('x')]);
  expect(await t.run()).toBe('quota');
  expect(t.spoken.at(-1)).toMatchObject({ text: KO.quota, lang: 'ko-KR' });
  expect(t.ended).toEqual([t.sessions[0].id]);
});

test('auth error ends loop', async () => {
  const t = setup([new AuthError('x')]);
  expect(await t.run()).toBe('auth');
  expect(t.spoken.at(-1)).toMatchObject({ text: KO.auth, lang: 'ko-KR' });
  expect(t.ended).toEqual([t.sessions[0].id]);
});

test('abort returns paused without ending session', async () => {
  const t = setup([]);
  expect(await t.run()).toBe('paused');
  expect(t.ended).toEqual([]);
});

test('history passed to send contains prior transcripts and aiLines', async () => {
  const t = setup([res(), res({ transcript: 'Kim', aiLine: 'Thanks' })]);
  await t.run();
  expect(t.sent[0].history).toEqual([{ role: 'ai', text: scenario.openingLine }]);
  expect(t.sent[1].history).toEqual([
    { role: 'ai', text: scenario.openingLine },
    { role: 'user', text: 'I have a reservation' },
    { role: 'ai', text: 'Great, your name please?' },
  ]);
  expect(t.turns.map((x) => x.idx)).toEqual([0, 1]);
});

test('unexpected error ends loop with spoken error notice', async () => {
  const t = setup([new Error('boom')]);
  expect(await t.run()).toBe('error');
  expect(t.spoken.at(-1)).toMatchObject({ text: KO.error });
  expect(t.ended).toEqual([t.sessions[0].id]);
});

test('listen rejected with AbortError (audio interrupted) pauses even without signal abort', async () => {
  const t = setup([]);
  t.deps.listen = async () => {
    throw new DOMException('interrupted', 'AbortError');
  };
  expect(await t.run()).toBe('paused');
  expect(t.ended).toEqual([]);
});

describe('review fixes', () => {
  test('pause right after the last goal still counts the mission as achieved on resume', async () => {
    const state = createLoopState(scenario, CONFIG.ttsRate.normal);
    const a = setup([res(), res(), res({ goalsDone: [1, 2], aiLine: 'LAST' })]);
    const origSpeak = a.deps.speak;
    a.deps.speak = async (text, o) => {
      if (text === 'LAST') {
        a.ctrl.abort();
      }
      return origSpeak(text, o);
    };
    expect(await runCarLoop(a.deps, { scenario, weakPhrases: [], state }, a.ctrl.signal)).toBe('paused');
    const b = setup([], { utterances: 0 });
    await runCarLoop(b.deps, { scenario, weakPhrases: [], state }, b.ctrl.signal);
    expect(b.finished).toEqual([{ scenarioId: scenario.id, o: { achieved: true, userTurns: 3, corrections: 0 } }]);
    expect(texts(b.spoken)).toContain(KO.goalAll);
  });

  test('quit after the last goal (paused before congratulating) evaluates as achieved', async () => {
    const state = createLoopState(scenario, CONFIG.ttsRate.normal);
    const a = setup([res({ goalsDone: [1, 2] })]);
    const origSpeak = a.deps.speak;
    a.deps.speak = async (text, o) => {
      if (text === 'Great, your name please?') a.ctrl.abort();
      return origSpeak(text, o);
    };
    await runCarLoop(a.deps, { scenario, weakPhrases: [], state }, a.ctrl.signal);
    await closeMissionForQuit(a.deps, state);
    expect(a.finished[0].o.achieved).toBe(true);
    expect(a.updates).toContainEqual({ sid: a.sessions[0].id, achieved: true });
  });

  test('pause during the goal intro replays the goals and opening line on resume', async () => {
    const state = createLoopState(scenario, CONFIG.ttsRate.normal);
    const a = setup([]);
    a.deps.speak = async (text) => {
      if (text.startsWith(KO.goalIntro)) a.ctrl.abort();
    };
    expect(await runCarLoop(a.deps, { scenario, weakPhrases: [], state }, a.ctrl.signal)).toBe('paused');
    const b = setup([], { utterances: 0 });
    await runCarLoop(b.deps, { scenario, weakPhrases: [], state }, b.ctrl.signal);
    expect(b.all[0].text.startsWith(KO.goalIntro)).toBe(true);
    expect(b.all[1].text).toBe(scenario.openingLine);
    expect(b.missionsStarted).toEqual([]);
  });
});

describe('minimum exchanges', () => {
  test('goals done early do not end the mission before the minimum number of exchanges', async () => {
    // difficulty 2 → at least 4 exchanges
    const t = setup([res({ goalsDone: [1, 2] }), res(), res(), res()], { difficulty: 2 });
    await t.run();
    const allIdx = texts(t.spoken).indexOf(KO.goalAll);
    expect(allIdx).toBeGreaterThan(-1);
    expect(t.turns.filter((x) => x.sessionId === t.sessions[0].id)).toHaveLength(4);
    expect(t.finished).toEqual([{ scenarioId: scenario.id, o: { achieved: true, userTurns: 4, corrections: 0 } }]);
  });

  test('after 3 exchanges with goals done the mission is not finished yet at difficulty 2', async () => {
    const t = setup([res({ goalsDone: [1, 2] }), res(), res()], { difficulty: 2 });
    await t.run();
    expect(texts(t.spoken)).not.toContain(KO.goalAll);
    expect(t.finished).toEqual([]);
  });

  test('the exchange count is sent with each turn', async () => {
    const t = setup([res(), res()]);
    await t.run();
    expect(t.sent.map((r) => r.exchanges)).toEqual([0, 1]);
  });
});
