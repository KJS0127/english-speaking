import 'fake-indexeddb/auto';
import { openDb, type Db } from '../../src/store/db';
import { renderHomeMode, type HomeModeDeps } from '../../src/ui/homeMode';
import { SCENARIOS } from '../../src/scenarios';
import type { Mission } from '../../src/missions';
import { AuthError, FatalApiError, QuotaError, RateLimitError } from '../../src/ai/errors';
import type { TurnResult } from '../../src/ai/schema';

let n = 0;
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
};
const scenario = SCENARIOS[0];
const res = (over: Partial<TurnResult> = {}): TurnResult => ({
  transcript: 'I want coffee', command: 'none', aiLine: 'What size?', aiLineKo: '어떤 사이즈요?',
  suggestedReply: 'A small one, please.', correction: null, pronunciation: null, goalsDone: [], ...over,
});

let db: Db;
const mission: Mission = {
  titleKo: '라테 주문', goals: ['라테 주문하기', '영수증 요청하기'], situationEn: 'x', openingLine: scenario.openingLine,
  difficulty: 2, source: 'ai',
};
let deps: HomeModeDeps;
let send: ReturnType<typeof vi.fn>;
const root = () => document.getElementById('root')!;
const q = <T extends Element>(sel: string) => root().querySelector<T>(sel)!;
const byText = (text: string) =>
  [...root().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!;

beforeEach(async () => {
  document.body.innerHTML = '<div id="root"></div>';
  db = await openDb(`hm-${++n}`);
  await db.setSetting('apiKey', 'K');
  send = vi.fn().mockResolvedValue(res());
  deps = {
    db,
    mic: async () => ({ listen: async () => new Float32Array([0.1, 0.2]), close() {} }),
    send,
    speak: vi.fn().mockResolvedValue(undefined),
    unlock: () => {},
    startMission: vi.fn(async () => mission),
    finishMission: vi.fn(async () => null),
  };
});

async function talk() {
  q<HTMLButtonElement>('button.mic').click();
  await flush();
}

test('opening and leaving without speaking leaves no empty session', async () => {
  await renderHomeMode(root(), deps, scenario);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await flush();
  expect(await db.listSessions()).toHaveLength(0);
});

test('level selector offers 쓰고 말하기 / 힌트 보고 말하기 / 바로 말하기', async () => {
  await renderHomeMode(root(), deps, scenario);
  const labels = [...root().querySelectorAll('.levels button')].map((b) => b.textContent);
  expect(labels).toEqual(['쓰고 말하기', '힌트 보고 말하기', '바로 말하기']);
});

test('shows the opening line', async () => {
  await renderHomeMode(root(), deps, scenario);
  expect(q('.chat').textContent).toContain(scenario.openingLine);
});

test('level 1 requires typed text before mic button enables and sends typedText', async () => {
  await renderHomeMode(root(), deps, scenario);
  byText('쓰고 말하기').click();
  const mic = q<HTMLButtonElement>('button.mic');
  expect(mic.disabled).toBe(true);
  const ta = q<HTMLTextAreaElement>('textarea');
  ta.value = 'I want a latte';
  ta.dispatchEvent(new Event('input'));
  expect(mic.disabled).toBe(false);
  await talk();
  expect(send.mock.calls[0][0].typedText).toBe('I want a latte');
  expect(send.mock.calls[0][0].level).toBe(1);
  expect(send.mock.calls[0][0].mode).toBe('home');
  expect(send.mock.calls[0][1]).toBe('K');
});

test('level 2 hint button reveals aiLineKo and suggestedReply of last AI turn', async () => {
  await renderHomeMode(root(), deps, scenario);
  byText('힌트 보고 말하기').click();
  await talk();
  byText('힌트 보기').click();
  expect(q('.hintbox').textContent).toContain('어떤 사이즈요?');
  expect(q('.hintbox').textContent).toContain('A small one, please.');
});

test('level 3 shows no hint button', async () => {
  await renderHomeMode(root(), deps, scenario);
  byText('바로 말하기').click();
  expect(byText('힌트 보기')).toBeUndefined();
});

test('turn shows transcript and AI line, speaks it and saves it', async () => {
  await renderHomeMode(root(), deps, scenario);
  await talk();
  expect(q('.chat').textContent).toContain('I want coffee');
  expect(q('.chat').textContent).toContain('What size?');
  expect(deps.speak).toHaveBeenCalledWith('What size?', expect.objectContaining({ lang: 'en-US' }));
  const sessions = await db.listSessions();
  expect(sessions).toHaveLength(1);
  expect(await db.getTurns(sessions[0].id)).toHaveLength(1);
});

test('after a reply the page scrolls to the very bottom (above the bottom bar)', async () => {
  const spy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  await renderHomeMode(root(), deps, scenario);
  await talk();
  expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ top: document.documentElement.scrollHeight }));
  spy.mockRestore();
});

test('during conversation corrections show only a small marker', async () => {
  send.mockResolvedValue(res({ correction: { original: 'I want coffee', better: "I'd like a coffee", why: '공손' } }));
  await renderHomeMode(root(), deps, scenario);
  await talk();
  expect(q('.bubble.me .mark').textContent).toBe('•');
  expect(q('.chat').textContent).not.toContain("I'd like a coffee");
});

test('ending conversation shows all corrections and pronunciation notes', async () => {
  send.mockResolvedValue(
    res({ correction: { original: 'I want coffee', better: "I'd like a coffee", why: '더 공손해요' }, pronunciation: 'f 발음 주의' }),
  );
  await renderHomeMode(root(), deps, scenario);
  await talk();
  byText('대화 끝내기').click();
  await flush();
  const text = q('.summary').textContent!;
  expect(text).toContain("I'd like a coffee");
  expect(text).toContain('더 공손해요');
  expect(text).toContain('f 발음 주의');
  expect((await db.listSessions())[0].endedAt).not.toBeNull();
});

test('empty transcript asks to say again and saves nothing', async () => {
  send.mockResolvedValue(res({ transcript: '' }));
  await renderHomeMode(root(), deps, scenario);
  await talk();
  expect(q('.status').textContent).toBe('잘 못 들었어요. 다시 말해 주세요.');
  expect(await db.listSessions()).toHaveLength(0);
});

test('AuthError shows message with link to settings', async () => {
  send.mockRejectedValue(new AuthError('x'));
  await renderHomeMode(root(), deps, scenario);
  await talk();
  expect(q('.status').textContent).toContain('API 키에 문제가 있어요');
  expect(q('.status a[href="#/settings"]')).not.toBeNull();
});

test('FatalApiError shows the API detail so the cause can be found', async () => {
  send.mockRejectedValue(new FatalApiError('gemini-3.5-flash-lite (HTTP 400): Unknown name "foo"'));
  await renderHomeMode(root(), deps, scenario);
  await talk();
  expect(q('.status').textContent).toContain('앱 설정에 문제가 있어요');
  expect(q('.status').textContent).toContain('Unknown name "foo"');
});

test('RateLimitError asks to wait and keeps mic enabled', async () => {
  send.mockRejectedValue(new RateLimitError('x', 5000));
  await renderHomeMode(root(), deps, scenario);
  await talk();
  expect(q('.status').textContent).toContain('잠시 후에 다시 눌러 주세요');
  expect(q<HTMLButtonElement>('button.mic').disabled).toBe(false);
});

test('tapping "다 말했어요" while listening sends what was said right away', async () => {
  const seen: any[] = [];
  deps.mic = async () => ({
    listen: (o: any = {}) => {
      seen.push(o);
      return new Promise((resolve) => o.finish?.addEventListener('abort', () => resolve(new Float32Array([0.1, 0.2]))));
    },
    close() {},
  });
  await renderHomeMode(root(), deps, scenario);
  q<HTMLButtonElement>('button.mic').click();
  await flush();
  expect(q('button.mic').textContent).toBe('■ 다 말했어요');
  expect(seen[0].silenceMs).toBe(2000);
  q<HTMLButtonElement>('button.mic').click();
  await flush();
  expect(send).toHaveBeenCalledTimes(1);
  expect(q('.chat').textContent).toContain('What size?');
  expect(q('button.mic').textContent).toBe('🎤 말하기');
});

test('"다 말했어요" with nothing recorded just stops listening quietly', async () => {
  deps.mic = async () => ({
    listen: (o: any = {}) =>
      new Promise((_r, rej) => o.finish?.addEventListener('abort', () => rej(new DOMException('a', 'AbortError')))),
    close() {},
  });
  await renderHomeMode(root(), deps, scenario);
  q<HTMLButtonElement>('button.mic').click();
  await flush();
  q<HTMLButtonElement>('button.mic').click();
  await flush();
  expect(send).not.toHaveBeenCalled();
  expect(q('button.mic').textContent).toBe('🎤 말하기');
  expect(q('.status').textContent).toBe('');
});

test('leaving the page closes the mic and ends the session', async () => {
  let closed = 0;
  deps.mic = async () => ({ listen: async () => new Float32Array([0.1]), close() { closed++; } });
  await renderHomeMode(root(), deps, scenario);
  await talk();
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await flush();
  expect(closed).toBe(1);
  expect((await db.listSessions())[0].endedAt).not.toBeNull();
});

test('QuotaError shows 오늘 무료 사용량이 끝났어요 and disables mic', async () => {
  send.mockRejectedValue(new QuotaError('x'));
  await renderHomeMode(root(), deps, scenario);
  await talk();
  expect(q('.status').textContent).toContain('오늘 무료 사용량이 끝났어요');
  expect(q<HTMLButtonElement>('button.mic').disabled).toBe(true);
});

describe('missions', () => {
  test('shows a preparing message with the mic locked, then the goal card with level', async () => {
    let resolve!: (m: Mission) => void;
    deps.startMission = vi.fn(() => new Promise<Mission>((r) => (resolve = r)));
    const p = renderHomeMode(root(), deps, scenario);
    await flush();
    expect(root().textContent).toContain('이번 목표를 준비하고 있어요');
    expect(q<HTMLButtonElement>('button.mic').disabled).toBe(true);
    resolve(mission);
    await p;
    expect(q('.goals').textContent).toContain('라테 주문');
    expect(q('.goals').textContent).toContain('2단계');
    expect([...root().querySelectorAll('.goals li')].map((li) => li.textContent)).toEqual(['라테 주문하기', '영수증 요청하기']);
    expect(q<HTMLButtonElement>('button.mic').disabled).toBe(false);
  });

  test('practice-method buttons are labelled 연습 방식', async () => {
    await renderHomeMode(root(), deps, scenario);
    expect(q('.levels-label').textContent).toBe('연습 방식');
  });

  test('goal checkbox updates when goalsDone arrives and mission is sent with the turn', async () => {
    send.mockResolvedValue(res({ goalsDone: [1] }));
    await renderHomeMode(root(), deps, scenario);
    await talk();
    const items = [...root().querySelectorAll('.goals li')];
    expect(items.map((li) => li.getAttribute('data-done'))).toEqual(['true', 'false']);
    expect(send.mock.calls[0][0].mission).toBe(mission);
    expect(send.mock.calls[0][0].achieved).toEqual([]);
    expect(send.mock.calls[0][0].exchanges).toBe(0);
  });

  test('session is saved with mission fields', async () => {
    await renderHomeMode(root(), deps, scenario);
    await talk();
    expect((await db.listSessions())[0]).toMatchObject({ missionTitle: '라테 주문', goals: mission.goals, difficulty: 2 });
  });

  test('all goals shows success with level-up text and a next-mission button', async () => {
    (deps.finishMission as any).mockResolvedValue('up');
    send.mockResolvedValueOnce(res({ goalsDone: [1] })).mockResolvedValueOnce(res({ goalsDone: [2] }));
    await renderHomeMode(root(), deps, scenario);
    await talk();
    await talk();
    // difficulty 2 needs at least 4 exchanges: goals are done but the role-play continues
    expect(root().textContent).not.toContain('목표 달성');
    expect(deps.finishMission).not.toHaveBeenCalled();
    await talk();
    await talk();
    expect(root().textContent).toContain('목표 달성');
    expect(root().textContent).toContain('3단계로 올라갔어요!');
    expect(deps.finishMission).toHaveBeenCalledTimes(1);
    expect(deps.finishMission).toHaveBeenCalledWith(scenario.id, { achieved: true, userTurns: 4, corrections: 0 });
    expect((await db.listSessions())[0].achieved).toBe(true);
    byText('다음 목표').click();
    await flush();
    expect(deps.startMission).toHaveBeenCalledTimes(2);
  });

  test('leaving evaluates the unfinished mission once', async () => {
    await renderHomeMode(root(), deps, scenario);
    await talk();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flush();
    expect(deps.finishMission).toHaveBeenCalledTimes(1);
    expect(deps.finishMission).toHaveBeenCalledWith(scenario.id, { achieved: false, userTurns: 1, corrections: 0 });
  });

  test('next command evaluates and starts a new mission in the same scenario', async () => {
    send.mockResolvedValueOnce(res()).mockResolvedValueOnce(res({ command: 'next', aiLine: 'OK' }));
    await renderHomeMode(root(), deps, scenario);
    await talk();
    await talk();
    expect(deps.finishMission).toHaveBeenCalledTimes(1);
    expect(deps.startMission).toHaveBeenCalledTimes(2);
  });
});

describe('review fixes', () => {
  test('ending after a quota error does not evaluate difficulty', async () => {
    send.mockResolvedValueOnce(res()).mockResolvedValueOnce(res()).mockRejectedValueOnce(new QuotaError('x'));
    await renderHomeMode(root(), deps, scenario);
    await talk();
    await talk();
    await talk();
    byText('대화 끝내기').click();
    await flush();
    expect(deps.finishMission).not.toHaveBeenCalled();
    expect((await db.listSessions())[0].endedAt).not.toBeNull();
  });

  test('leaving while the final reply is spoken still counts as achieved', async () => {
    let finishSpeak!: () => void;
    deps.speak = vi.fn((text: string) => (text === 'What size?' ? new Promise<void>((r) => (finishSpeak = r)) : Promise.resolve()));
    send.mockResolvedValue(res({ goalsDone: [1, 2] }));
    await renderHomeMode(root(), deps, scenario);
    q<HTMLButtonElement>('button.mic').click();
    await flush();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flush();
    finishSpeak();
    await flush();
    expect(deps.finishMission).toHaveBeenCalledTimes(1);
    expect(deps.finishMission).toHaveBeenCalledWith(scenario.id, { achieved: true, userTurns: 1, corrections: 0 });
  });
});
