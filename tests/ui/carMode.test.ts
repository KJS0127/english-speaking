import 'fake-indexeddb/auto';
import { openDb, type Db } from '../../src/store/db';
import { renderCarMode, type CarModeDeps, SAFETY_NOTE, NO_WAKELOCK_WARN } from '../../src/ui/carMode';
import { SCENARIOS } from '../../src/scenarios';
import type { LoopEnd } from '../../src/session/carLoop';

let n = 0;
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
};
const scenario = SCENARIOS[4];
const root = () => document.getElementById('root')!;
const q = <T extends Element>(sel: string) => root().querySelector<T>(sel);

let db: Db;
let deps: CarModeDeps;
let wakeRequests: number;
let released: number;
let loopCalls: { ctx: any; signal: AbortSignal }[];
let loopResult: LoopEnd | null;

function setVisibility(v: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(async () => {
  document.body.innerHTML = '<div id="root"></div>';
  setVisibility('visible');
  db = await openDb(`car-${++n}`);
  await db.setSetting('apiKey', 'K');
  await db.addTurn({
    id: 't', sessionId: 'old', idx: 0, at: 1, transcript: 'x', aiLine: 'y',
    correction: { original: 'I want', better: "I'd like", why: '' }, pronunciation: null,
  });
  wakeRequests = 0;
  released = 0;
  loopCalls = [];
  loopResult = null;
  deps = {
    db,
    mic: async () => ({ listen: async () => new Float32Array(1), close() {} }),
    send: vi.fn(),
    speak: vi.fn().mockResolvedValue(undefined),
    unlock: vi.fn(),
    wakeLock: {
      async request() {
        wakeRequests++;
        return { release: async () => { released++; } };
      },
    },
    startMission: vi.fn(async () => ({ titleKo: 'M', goals: ['g'], situationEn: 's', openingLine: 'Hi', difficulty: 1, source: 'ai' as const })),
    finishMission: vi.fn(async () => null),
    runLoop: async (d, ctx, signal) => {
      loopCalls.push({ ctx, signal });
      // mimic the real loop: first run starts a mission session
      if (ctx.state && !ctx.state.mission) {
        ctx.state.mission = await d.startMission(ctx.scenario, signal);
        ctx.state.sessionId = 'sess-' + loopCalls.length;
        await d.db.startSession({ id: ctx.state.sessionId, scenarioId: ctx.scenario.id, mode: 'car', startedAt: 1 });
      }
      return new Promise<LoopEnd>((resolve) => {
        signal.addEventListener('abort', () => resolve('paused'));
        if (loopResult) resolve(loopResult);
      });
    },
  };
});

test('shows one large start button and the safety notice', async () => {
  await renderCarMode(root(), deps, scenario);
  expect(root().querySelectorAll('button.car-start')).toHaveLength(1);
  expect(SAFETY_NOTE).toBe('출발 전에 시작을 눌러 주세요. 운전 중에는 화면을 보지 마세요.');
  expect(root().textContent).toContain(SAFETY_NOTE);
  expect(root().textContent).toContain(scenario.titleKo);
});

test('start requests wake lock, opens mic, unlocks speech, starts session with weak phrases', async () => {
  await renderCarMode(root(), deps, scenario);
  q<HTMLButtonElement>('button.car-start')!.click();
  await flush();
  expect(deps.unlock).toHaveBeenCalled();
  expect(wakeRequests).toBe(1);
  expect(loopCalls).toHaveLength(1);
  expect(loopCalls[0].ctx.scenario).toBe(scenario);
  expect(loopCalls[0].ctx.weakPhrases).toEqual([{ original: 'I want', better: "I'd like" }]);
  const sessions = await db.listSessions();
  expect(sessions.map((s) => s.id)).toEqual([loopCalls[0].ctx.state.sessionId]);
  expect(sessions[0].mode).toBe('car');
  expect(q('button.car-start')).toBeNull();
});

test('warns before start when wake lock is unavailable', async () => {
  NO_WAKELOCK_WARN satisfies string;
  await renderCarMode(root(), { ...deps, wakeLock: undefined }, scenario);
  expect(NO_WAKELOCK_WARN).toBe('이 기기에서는 화면 켜짐 유지가 안 돼요. 화면 자동 잠금을 꺼 주세요.');
  expect(root().textContent).toContain(NO_WAKELOCK_WARN);
});

test('visibility hidden aborts loop (paused) and shows 이어하기 button', async () => {
  await renderCarMode(root(), deps, scenario);
  q<HTMLButtonElement>('button.car-start')!.click();
  await flush();
  setVisibility('hidden');
  await flush();
  expect(loopCalls[0].signal.aborted).toBe(true);
  expect(released).toBe(1);
  setVisibility('visible');
  await flush();
  expect(q<HTMLButtonElement>('button.car-start')!.textContent).toBe('이어하기');
});

test('이어하기 resumes with same session id', async () => {
  await renderCarMode(root(), deps, scenario);
  q<HTMLButtonElement>('button.car-start')!.click();
  await flush();
  setVisibility('hidden');
  await flush();
  setVisibility('visible');
  await flush();
  q<HTMLButtonElement>('button.car-start')!.click();
  await flush();
  expect(loopCalls).toHaveLength(2);
  expect(loopCalls[1].ctx.state).toBe(loopCalls[0].ctx.state);
  expect(await db.listSessions()).toHaveLength(1);
});

test.each([
  ['stopped', '연습을 마쳤어요.'],
  ['quota', '오늘 무료 사용량이 끝났어요.'],
  ['auth', 'API 키에 문제가 있어요.'],
] as const)('loop end %s shows matching message and review link', async (end, msg) => {
  loopResult = end;
  await renderCarMode(root(), deps, scenario);
  q<HTMLButtonElement>('button.car-start')!.click();
  await flush();
  expect(root().textContent).toContain(msg);
  expect(q('a[href="#/review"]')).not.toBeNull();
  expect(released).toBe(1);
});

test('loop end error shows a problem message', async () => {
  loopResult = 'error';
  await renderCarMode(root(), deps, scenario);
  q<HTMLButtonElement>('button.car-start')!.click();
  await flush();
  expect(root().textContent).toContain('문제가 생겨서 연습을 마쳤어요.');
});

test('passes saved voice rate and keeps the same conversation state across resumes', async () => {
  await db.setSetting('ttsRate', 0.8);
  await renderCarMode(root(), deps, scenario);
  q<HTMLButtonElement>('button.car-start')!.click();
  await flush();
  expect(loopCalls[0].ctx.rate).toBe(0.8);
  expect(loopCalls[0].ctx.state).toBeDefined();
  setVisibility('hidden');
  await flush();
  setVisibility('visible');
  await flush();
  q<HTMLButtonElement>('button.car-start')!.click();
  await flush();
  expect(loopCalls[1].ctx.state).toBe(loopCalls[0].ctx.state);
});

test('failed wake lock request shows and speaks the warning', async () => {
  await renderCarMode(
    root(),
    { ...deps, wakeLock: { request: async () => { throw new Error('NotAllowed'); } } },
    scenario,
  );
  q<HTMLButtonElement>('button.car-start')!.click();
  await flush();
  expect(root().textContent).toContain(NO_WAKELOCK_WARN);
  expect(deps.speak).toHaveBeenCalledWith(NO_WAKELOCK_WARN, expect.objectContaining({ lang: 'ko-KR' }));
});

test('leaving the page during the loop does not overwrite the new page', async () => {
  await renderCarMode(root(), deps, scenario);
  q<HTMLButtonElement>('button.car-start')!.click();
  await flush();
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  root().replaceChildren(document.createTextNode('OTHER PAGE'));
  await flush();
  expect(root().textContent).toBe('OTHER PAGE');
});

test('quit button on the running screen ends the session and goes home', async () => {
  location.hash = '#/car/' + scenario.id;
  await renderCarMode(root(), deps, scenario);
  q<HTMLButtonElement>('button.car-start')!.click();
  await flush();
  const quit = q<HTMLButtonElement>('button.car-quit')!;
  expect(quit.textContent).toBe('그만하고 홈으로');
  quit.click();
  await flush();
  expect(loopCalls[0].signal.aborted).toBe(true);
  expect((await db.listSessions())[0].endedAt).not.toBeNull();
  expect(location.hash).toBe('#/');
  expect(released).toBe(1);
  expect(deps.finishMission).toHaveBeenCalledWith(scenario.id, { achieved: false, userTurns: 0, corrections: 0 });
});

test('mic permission failure shows message', async () => {
  await renderCarMode(root(), { ...deps, mic: async () => { throw new Error('denied'); } }, scenario);
  q<HTMLButtonElement>('button.car-start')!.click();
  await flush();
  expect(root().textContent).toContain('마이크를 사용할 수 없어요');
});

test('leaving the paused car screen closes and evaluates the mission', async () => {
  await renderCarMode(root(), deps, scenario);
  q<HTMLButtonElement>('button.car-start')!.click();
  await flush();
  setVisibility('hidden');
  await flush();
  setVisibility('visible');
  await flush();
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await flush();
  expect(deps.finishMission).toHaveBeenCalledTimes(1);
  expect((await db.listSessions())[0].endedAt).not.toBeNull();
});
