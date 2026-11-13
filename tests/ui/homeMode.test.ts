import 'fake-indexeddb/auto';
import { openDb, type Db } from '../../src/store/db';
import { renderHomeMode, type HomeModeDeps } from '../../src/ui/homeMode';
import { SCENARIOS } from '../../src/scenarios';
import { AuthError, FatalApiError, QuotaError, RateLimitError } from '../../src/ai/errors';
import type { TurnResult } from '../../src/ai/schema';

let n = 0;
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
};
const scenario = SCENARIOS[0];
const res = (over: Partial<TurnResult> = {}): TurnResult => ({
  transcript: 'I want coffee', command: 'none', aiLine: 'What size?', aiLineKo: '어떤 사이즈요?',
  suggestedReply: 'A small one, please.', correction: null, pronunciation: null, ...over,
});

let db: Db;
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

test('tapping the mic button while listening cancels listening', async () => {
  let closed = 0;
  deps.mic = async () => ({
    listen: ({ signal }: { signal?: AbortSignal } = {}) =>
      new Promise((_r, rej) => signal?.addEventListener('abort', () => rej(new DOMException('a', 'AbortError')))),
    close() { closed++; },
  });
  await renderHomeMode(root(), deps, scenario);
  q<HTMLButtonElement>('button.mic').click();
  await flush();
  expect(q('button.mic').textContent).toBe('■ 그만 듣기');
  q<HTMLButtonElement>('button.mic').click();
  await flush();
  expect(q('button.mic').textContent).toBe('🎤 말하기');
  expect(send).not.toHaveBeenCalled();
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
