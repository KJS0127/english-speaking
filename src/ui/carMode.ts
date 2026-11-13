import { CONFIG } from '../config';
import type { Mic } from '../audio/mic';
import type { SpeakOpts } from '../audio/speaker';
import type { TurnRequest } from '../ai/prompt';
import type { TurnResult } from '../ai/schema';
import type { Scenario } from '../scenarios';
import type { Mission } from '../missions';
import { closeMissionForQuit, createLoopState, runCarLoop, type LoopEnd, type LoopState } from '../session/carLoop';
import type { LevelChange, Outcome } from '../session/difficulty';
import type { Db } from '../store/db';
import { h, mount } from './dom';
import { navigate } from './router';

export const SAFETY_NOTE = '출발 전에 시작을 눌러 주세요. 운전 중에는 화면을 보지 마세요.';
export const NO_WAKELOCK_WARN = '이 기기에서는 화면 켜짐 유지가 안 돼요. 화면 자동 잠금을 꺼 주세요.';

export interface WakeLockLike {
  request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener?(type: 'release', cb: () => void): void }>;
}

export interface CarModeDeps {
  db: Db;
  mic: () => Promise<Mic>;
  send: (req: TurnRequest, apiKey: string, signal?: AbortSignal) => Promise<TurnResult>;
  speak: (text: string, opts: SpeakOpts) => Promise<void>;
  unlock: () => void;
  stopSpeaking?: () => void;
  wakeLock?: WakeLockLike;
  runLoop?: typeof runCarLoop;
  startMission: (scenario: Scenario, signal?: AbortSignal) => Promise<Mission>;
  finishMission: (scenarioId: string, o: Outcome) => Promise<LevelChange>;
}

const END_MSG: Record<Exclude<LoopEnd, 'paused'>, string> = {
  stopped: '연습을 마쳤어요.',
  quota: '오늘 무료 사용량이 끝났어요.',
  auth: 'API 키에 문제가 있어요.',
  error: '문제가 생겨서 연습을 마쳤어요.',
};

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export async function renderCarMode(root: HTMLElement, deps: CarModeDeps, scenario: Scenario): Promise<void> {
  const runLoop = deps.runLoop ?? runCarLoop;
  const apiKey = (await deps.db.getSetting<string>('apiKey')) ?? '';
  const rate = (await deps.db.getSetting<number>('ttsRate')) ?? CONFIG.ttsRate.normal;
  const state: LoopState = createLoopState(scenario, rate);
  let mic: Mic | null = null;
  let lock: { release(): Promise<void> } | null = null;
  let ctrl: AbortController | null = null;
  let running = false;
  let left = false; // user navigated away from this page
  let quitting = false;

  const stateEl = h('div', { className: 'state', 'aria-live': 'polite' });
  const warnEl = h('p', { className: 'note warn', hidden: true }, NO_WAKELOCK_WARN);
  const setState = (s: string) => {
    stateEl.textContent = s;
  };
  const koSay = (text: string) => deps.speak(text, { lang: 'ko-KR', rate: CONFIG.ttsRate.normal });

  const releaseLock = async () => {
    const l = lock;
    lock = null;
    await l?.release().catch(() => {});
  };

  const screen = (...children: (Node | null)[]) => {
    if (left) return;
    mount(root, h('div', { className: 'car-screen' }, h('div', { className: 'title' }, scenario.titleKo), ...(children.filter(Boolean) as Node[])));
  };

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
      end === 'auth' || end === 'error' ? h('a', { href: '#/settings' }, '설정에서 확인하기') : null,
      h('a', { href: '#/review' }, '오늘 대화 복습하기'),
      h('a', { href: '#/' }, '← 홈으로'),
    );

  const requestLock = async (): Promise<boolean> => {
    if (!deps.wakeLock) return false;
    try {
      const l = await deps.wakeLock.request('screen');
      lock = l;
      l.addEventListener?.('release', () => {
        // Released by the system while running (not by us): warn the driver.
        if (running && lock === l) {
          warnEl.hidden = false;
          void koSay(NO_WAKELOCK_WARN);
        }
      });
      return true;
    } catch {
      return false;
    }
  };

  async function start() {
    if (running) return;
    running = true;
    deps.unlock();
    const locked = await requestLock();
    try {
      mic ??= await deps.mic();
    } catch {
      running = false;
      await releaseLock();
      showStart('시작', h('p', { className: 'note warn' }, '마이크를 사용할 수 없어요. 마이크 권한을 허용해 주세요.'));
      return;
    }
    const weakPhrases = (await deps.db.topWeakPhrases(5)).map((w) => ({ original: w.original, better: w.better }));
    ctrl = new AbortController();
    warnEl.hidden = locked || !deps.wakeLock;
    screen(
      stateEl,
      warnEl,
      h('p', { className: 'note' }, '말로만 조작해요: 목표 · 다시 · 천천히 · 한국어로 · 힌트 · 다음 · 다른 상황 · 그만'),
      h('button', { className: 'car-quit', type: 'button', onclick: () => quit() }, '그만하고 홈으로'),
    );
    setState('준비 중');
    if (!locked && deps.wakeLock) await koSay(NO_WAKELOCK_WARN).catch(() => {});
    const m = mic;
    let end: LoopEnd;
    try {
      end = await runLoop(
        {
          listen: (o) => {
            setState('듣는 중');
            return m.listen(o);
          },
          send: (req, signal) => {
            setState('생각 중');
            return deps.send(req, apiKey, signal);
          },
          speak: (text, o) => {
            setState('말하는 중');
            return deps.speak(text, o);
          },
          startMission: (s, signal) => {
            setState('목표 준비 중');
            return deps.startMission(s, signal);
          },
          finishMission: deps.finishMission,
          db: deps.db,
          now: () => Date.now(),
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          newId,
        },
        { scenario, weakPhrases, rate, state },
        ctrl.signal,
      );
    } catch {
      end = 'error';
    }
    running = false;
    ctrl = null;
    await releaseLock();
    if (quitting || left) {
      mic?.close();
      mic = null;
      await closeMissionNow();
      if (quitting && !left) navigate({ name: 'home' });
      return;
    }
    if (end === 'paused') {
      showStart('이어하기');
    } else {
      mic?.close();
      mic = null;
      showEnd(end);
    }
  }

  const closeMissionNow = () =>
    closeMissionForQuit({ finishMission: deps.finishMission, db: deps.db, now: () => Date.now() }, state).catch(() => null);
  const pause = () => {
    ctrl?.abort();
    deps.stopSpeaking?.();
  };
  // Screen button for when parked: stop, save, go home (start() finishes the job once the loop stops).
  const quit = () => {
    quitting = true;
    pause();
  };
  const onVisibility = () => {
    if (left) return;
    if (!root.isConnected) return onLeave(); // page was torn down
    if (document.visibilityState === 'hidden') pause();
  };
  const onLeave = () => {
    left = true;
    // paused (not running): close and evaluate now; running: start() closes it once the loop stops
    if (!running) void closeMissionNow();
    pause();
    mic?.close();
    mic = null;
    document.removeEventListener('visibilitychange', onVisibility);
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('hashchange', onLeave, { once: true });

  showStart('시작');
}
