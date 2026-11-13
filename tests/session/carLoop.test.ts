import { runCarLoop, createLoopState, type LoopDeps } from '../../src/session/carLoop';
import { KO, EN_RETRY } from '../../src/session/phrases';
import { SCENARIOS, nextScenario } from '../../src/scenarios';
import { CONFIG } from '../../src/config';
import { AuthError, BadResponseError, FatalApiError, NetworkError, QuotaError, RateLimitError } from '../../src/ai/errors';
import type { TurnResult } from '../../src/ai/schema';
import type { TurnRequest } from '../../src/ai/prompt';

const scenario = SCENARIOS.find((s) => s.category === 'travel')!;
const res = (over: Partial<TurnResult> = {}): TurnResult => ({
  transcript: 'I have a reservation', command: 'none', aiLine: 'Great, your name please?', aiLineKo: '좋아요, 성함이요?',
  suggestedReply: 'My name is Kim.', correction: null, pronunciation: null, ...over,
});

type Step = TurnResult | Error;

function setup(steps: Step[], opts: { idleCalls?: number; utterances?: number } = {}) {
  const ctrl = new AbortController();
  const spoken: { text: string; lang: string; rate: number }[] = [];
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
      spoken.push({ text, lang: o.lang, rate: o.rate });
    },
    db: {
      async addTurn(t) {
        turns.push(t);
      },
      async endSession(sid) {
        ended.push(sid);
      },
    },
    now: () => 1000,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    newId: () => `id${id++}`,
  };
  const run = () => runCarLoop(deps, { sessionId: 'S', scenario, weakPhrases: [{ original: 'a', better: 'b' }] }, ctrl.signal);
  return { run, spoken, sent, turns, ended, sleeps, ctrl, listenIdleMs, deps };
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
    id: 'id0', sessionId: 'S', idx: 0, at: 1000, transcript: 'I have a reservation', aiLine: 'Great, your name please?',
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

test('next speaks KO.next then next scenario opening, and resets history', async () => {
  const t = setup([res(), res({ command: 'next', aiLine: 'OK' }), res({ aiLine: 'Hello again' })]);
  await t.run();
  const nxt = nextScenario(scenario);
  expect(t.spoken[2]).toMatchObject({ text: KO.next, lang: 'ko-KR' });
  expect(t.spoken[3]).toMatchObject({ text: nxt.openingLine, lang: 'en-US' });
  expect(t.sent[2].scenario).toBe(nxt);
  expect(t.sent[2].history).toEqual([{ role: 'ai', text: nxt.openingLine }]);
});

test('stop speaks KO.stop, ends session, returns stopped', async () => {
  const t = setup([res({ command: 'stop', aiLine: 'OK' })]);
  expect(await t.run()).toBe('stopped');
  expect(t.spoken.at(-1)).toMatchObject({ text: KO.stop, lang: 'ko-KR' });
  expect(t.ended).toEqual(['S']);
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
  expect(t.ended).toEqual(['S']);
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
  await runCarLoop(t.deps, { sessionId: 'S', scenario, weakPhrases: [], rate: 0.8 }, t.ctrl.signal);
  expect(t.spoken[0].rate).toBe(0.8);
});

test('resuming with the same state continues instead of restarting', async () => {
  const state = createLoopState(scenario, CONFIG.ttsRate.normal);
  const a = setup([res(), res({ command: 'next', aiLine: 'OK' })]);
  await runCarLoop(a.deps, { sessionId: 'S', scenario, weakPhrases: [], state }, a.ctrl.signal);
  const b = setup([res({ transcript: 'Hi', aiLine: 'Hello' })]);
  await runCarLoop(b.deps, { sessionId: 'S', scenario, weakPhrases: [], state }, b.ctrl.signal);
  const nxt = nextScenario(scenario);
  // no opening line again; same (next) scenario; history kept; idx continues
  expect(texts(b.spoken)).toEqual(['Hello']);
  expect(b.sent[0].scenario).toBe(nxt);
  expect(b.sent[0].history).toEqual([{ role: 'ai', text: nxt.openingLine }]);
  expect(b.turns[0].idx).toBe(1);
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
  expect(t.ended).toEqual(['S']);
});

test('auth error ends loop', async () => {
  const t = setup([new AuthError('x')]);
  expect(await t.run()).toBe('auth');
  expect(t.spoken.at(-1)).toMatchObject({ text: KO.auth, lang: 'ko-KR' });
  expect(t.ended).toEqual(['S']);
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
  expect(t.ended).toEqual(['S']);
});

test('listen rejected with AbortError (audio interrupted) pauses even without signal abort', async () => {
  const t = setup([]);
  t.deps.listen = async () => {
    throw new DOMException('interrupted', 'AbortError');
  };
  expect(await t.run()).toBe('paused');
  expect(t.ended).toEqual([]);
});
