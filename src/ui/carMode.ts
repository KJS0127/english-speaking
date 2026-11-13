import type { Mic } from '../audio/mic';
import type { SpeakOpts } from '../audio/speaker';
import type { TurnRequest } from '../ai/prompt';
import type { TurnResult } from '../ai/schema';
import type { Scenario } from '../scenarios';
import { runCarLoop, type LoopEnd } from '../session/carLoop';
import type { Db } from '../store/db';
import { h, mount } from './dom';

export const SAFETY_NOTE = '출발 전에 시작을 눌러 주세요. 운전 중에는 화면을 보지 마세요.';
export const NO_WAKELOCK_WARN = '이 기기에서는 화면 켜짐 유지가 안 돼요. 화면 자동 잠금을 꺼 주세요.';

export interface WakeLockLike {
  request(type: 'screen'): Promise<{ release(): Promise<void> }>;
}

export interface CarModeDeps {
  db: Db;
  mic: () => Promise<Mic>;
  send: (req: TurnRequest, apiKey: string) => Promise<TurnResult>;
  speak: (text: string, opts: SpeakOpts) => Promise<void>;
  unlock: () => void;
  wakeLock?: WakeLockLike;
  runLoop?: typeof runCarLoop;
}

const END_MSG: Record<Exclude<LoopEnd, 'paused'>, string> = {
  stopped: '연습을 마쳤어요.',
  quota: '오늘 무료 사용량이 끝났어요.',
  auth: 'API 키에 문제가 있어요.',
};

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export async function renderCarMode(root: HTMLElement, deps: CarModeDeps, scenario: Scenario): Promise<void> {
  const runLoop = deps.runLoop ?? runCarLoop;
  const apiKey = (await deps.db.getSetting<string>('apiKey')) ?? '';
  let sessionId: string | null = null;
  let mic: Mic | null = null;
  let lock: { release(): Promise<void> } | null = null;
  let ctrl: AbortController | null = null;
  let running = false;

  const stateEl = h('div', { className: 'state', 'aria-live': 'polite' });
  const setState = (s: string) => {
    stateEl.textContent = s;
  };

  const releaseLock = async () => {
    const l = lock;
    lock = null;
    await l?.release().catch(() => {});
  };

  const screen = (...children: (Node | null)[]) =>
    mount(root, h('div', { className: 'car-screen' }, h('div', { className: 'title' }, scenario.titleKo), ...children.filter(Boolean) as Node[]));

  const showStart = (label: string, extra?: Node) =>
    screen(
      h('button', { className: 'car-start', type: 'button', onclick: () => void start() }, label),
      h('p', { className: 'note' }, SAFETY_NOTE),
      deps.wakeLock ? null : h('p', { className: 'note warn' }, NO_WAKELOCK_WARN),
      extra ?? null,
      h('a', { href: '#/' }, '← 홈으로'),
    );

  const showEnd = (end: Exclude<LoopEnd, 'paused'>) =>
    screen(
      h('div', { className: 'state' }, END_MSG[end]),
      end === 'auth' ? h('a', { href: '#/settings' }, '설정에서 확인하기') : null,
      h('a', { href: '#/review' }, '오늘 대화 복습하기'),
      h('a', { href: '#/' }, '← 홈으로'),
    );

  async function start() {
    if (running) return;
    running = true;
    deps.unlock();
    try {
      lock = (await deps.wakeLock?.request('screen')) ?? null;
    } catch {
      lock = null;
    }
    try {
      mic ??= await deps.mic();
    } catch {
      running = false;
      await releaseLock();
      showStart('시작', h('p', { className: 'note warn' }, '마이크를 사용할 수 없어요. 마이크 권한을 허용해 주세요.'));
      return;
    }
    if (!sessionId) {
      sessionId = newId();
      await deps.db.startSession({ id: sessionId, scenarioId: scenario.id, mode: 'car', startedAt: Date.now() });
    }
    const weakPhrases = (await deps.db.topWeakPhrases(5)).map((w) => ({ original: w.original, better: w.better }));
    ctrl = new AbortController();
    screen(stateEl, h('p', { className: 'note' }, '말로만 조작해요: 다시 · 천천히 · 한국어로 · 힌트 · 다음 · 그만'));
    setState('준비 중');
    const m = mic;
    const end = await runLoop(
      {
        listen: (o) => {
          setState('듣는 중');
          return m.listen(o);
        },
        send: (req) => {
          setState('생각 중');
          return deps.send(req, apiKey);
        },
        speak: (text, o) => {
          setState('말하는 중');
          return deps.speak(text, o);
        },
        db: deps.db,
        now: () => Date.now(),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        newId,
      },
      { sessionId, scenario, weakPhrases },
      ctrl.signal,
    );
    running = false;
    ctrl = null;
    await releaseLock();
    if (end === 'paused') {
      showStart('이어하기');
    } else {
      mic?.close();
      mic = null;
      showEnd(end);
    }
  }

  const onVisibility = () => {
    if (!root.isConnected || !root.querySelector('.car-screen')) {
      document.removeEventListener('visibilitychange', onVisibility);
      return;
    }
    if (document.visibilityState === 'hidden') ctrl?.abort();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener(
    'hashchange',
    () => {
      ctrl?.abort();
      mic?.close();
      mic = null;
    },
    { once: true },
  );

  showStart('시작');
}
