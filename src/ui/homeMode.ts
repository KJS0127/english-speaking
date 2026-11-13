import { CONFIG } from '../config';
import type { Mic } from '../audio/mic';
import type { SpeakOpts } from '../audio/speaker';
import { encodeWav } from '../audio/wav';
import { AuthError, BadResponseError, FatalApiError, NetworkError, QuotaError, RateLimitError } from '../ai/errors';
import type { HistoryItem, TurnRequest } from '../ai/prompt';
import type { TurnResult } from '../ai/schema';
import type { Mission } from '../missions';
import { nextScenario, type Scenario } from '../scenarios';
import { MAX_LEVEL, MIN_LEVEL, type LevelChange, type Outcome } from '../session/difficulty';
import { KO } from '../session/phrases';
import type { Db, TurnRec } from '../store/db';
import { h, mount } from './dom';
import { navigate, routeToHash } from './router';

export interface HomeModeDeps {
  db: Db;
  mic: () => Promise<Mic>;
  send: (req: TurnRequest, apiKey: string) => Promise<TurnResult>;
  speak: (text: string, opts: SpeakOpts) => Promise<void>;
  unlock: () => void;
  stopSpeaking?: () => void;
  startMission: (scenario: Scenario) => Promise<Mission>;
  finishMission: (scenarioId: string, o: Outcome) => Promise<LevelChange>;
}

type Method = 1 | 2 | 3;
const METHODS: { level: Method; label: string }[] = [
  { level: 1, label: '쓰고 말하기' },
  { level: 2, label: '힌트 보고 말하기' },
  { level: 3, label: '바로 말하기' },
];

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

const levelChangeText = (change: LevelChange, from: number) =>
  change === 'up' ? KO.levelUp(Math.min(MAX_LEVEL, from + 1)) : change === 'down' ? KO.levelDown(Math.max(MIN_LEVEL, from - 1)) : '';

export async function renderHomeMode(root: HTMLElement, deps: HomeModeDeps, scenario: Scenario): Promise<void> {
  const apiKey = (await deps.db.getSetting<string>('apiKey')) ?? '';
  let rate = (await deps.db.getSetting<number>('ttsRate')) ?? CONFIG.ttsRate.normal;
  const sessionId = newId();
  const startedAt = Date.now();
  let started = false; // session is saved only once the first turn exists

  let method: Method = 2;
  let mic: Mic | null = null;
  let mission: Mission | null = null;
  let busy = true; // until the mission is ready
  let blocked = false;
  let closed = false; // mission evaluated + session ended
  let listenCtrl: AbortController | null = null;
  let idx = 0;
  const achieved: number[] = [];
  let userTurns = 0;
  let corrections = 0;
  const history: HistoryItem[] = [];
  const turns: TurnRec[] = [];
  let last = { aiLine: '', aiLineKo: '', suggestedReply: '' };

  const say = (text: string, lang: SpeakOpts['lang'] = 'en-US') => deps.speak(text, { lang, rate });

  const goalsCard = h('section', { className: 'goals' }, h('p', { className: 'hint' }, '이번 목표를 준비하고 있어요…'));
  const chat = h('div', { className: 'chat' });
  const status = h('p', { className: 'status', role: 'status' });
  const hintBox = h('div', { className: 'hintbox', hidden: true });
  const textArea = h('textarea', { rows: 2, placeholder: '먼저 영어로 써 보세요' });
  const micBtn = h('button', { className: 'mic primary', type: 'button' }, '🎤 말하기');
  const hintBtn = h('button', { type: 'button' }, '힌트 보기');
  const levelBar = h('div', { className: 'levels' });

  const aiBubble = (text: string) =>
    h('div', { className: 'bubble ai' }, text,
      h('div', { className: 'tools' }, h('button', { type: 'button', onclick: () => void say(text) }, '다시 듣기')));

  const setStatus = (msg: string | Node) => {
    status.replaceChildren(msg);
  };

  const renderGoals = () => {
    if (!mission) return;
    goalsCard.replaceChildren(
      h('div', { className: 'goals-head' },
        h('span', { className: 'goals-title' }, `🎯 ${mission.titleKo}`),
        h('span', { className: 'badge' }, `${mission.difficulty}단계`)),
      h('ul', {}, ...mission.goals.map((g, i) => {
        const done = achieved.includes(i + 1);
        return h('li', { 'data-done': String(done) }, g);
      })),
    );
  };

  const refresh = () => {
    for (const b of levelBar.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.level === String(method)));
    textArea.hidden = method !== 1;
    hintBtn.hidden = method !== 2;
    if (method !== 2) hintBtn.remove();
    else if (!hintBtn.isConnected) micBtn.before(hintBtn);
    hintBox.hidden = true;
    micBtn.textContent = listenCtrl ? '■ 그만 듣기' : '🎤 말하기';
    micBtn.disabled = listenCtrl ? false : busy || blocked || (method === 1 && !textArea.value.trim());
  };

  for (const { level: lv, label } of METHODS) {
    levelBar.append(h('button', { type: 'button', 'data-level': lv, onclick: () => { method = lv; refresh(); } }, label));
  }
  textArea.addEventListener('input', refresh);
  const showHint = () => {
    hintBox.replaceChildren(
      h('div', {}, last.aiLineKo ? `뜻: ${last.aiLineKo}` : '뜻: (아직 없어요)'),
      h('div', {}, last.suggestedReply ? `이렇게 말해 보세요: ${last.suggestedReply}` : ''),
    );
    hintBox.hidden = false;
  };
  hintBtn.addEventListener('click', showHint);

  /** Evaluates the mission (once), closes the mic and ends the saved session. */
  const close = async (isAchieved: boolean): Promise<LevelChange> => {
    listenCtrl?.abort();
    mic?.close();
    mic = null;
    if (closed) return null;
    closed = true;
    // all goals done counts as achieved even if the user left before the summary
    isAchieved = isAchieved || (!!mission && achieved.length >= mission.goals.length);
    if (started) {
      if (isAchieved) await deps.db.updateSession(sessionId, { achieved: true });
      await deps.db.endSession(sessionId, Date.now());
    }
    // a usage-limit stop is not the learner's failure (spec 5.5)
    if (blocked) return null;
    return deps.finishMission(scenario.id, { achieved: isAchieved, userTurns, corrections });
  };
  window.addEventListener('hashchange', () => void close(false), { once: true });

  const restart = () => void renderHomeMode(root, deps, scenario);

  const handleCommand = async (r: TurnResult): Promise<boolean> => {
    switch (r.command) {
      case 'repeat':
        await say(last.aiLine);
        return true;
      case 'slower':
        rate = CONFIG.ttsRate.slow;
        await say(last.aiLine);
        return true;
      case 'korean':
      case 'hint':
        showHint();
        return true;
      case 'goal':
        setStatus('목표는 위쪽 카드에서 확인하세요.');
        return true;
      case 'next':
        await close(false);
        restart();
        return true;
      case 'otherScenario':
        await close(false);
        navigate({ name: 'homeMode', scenarioId: nextScenario(scenario).id });
        return true;
      case 'stop':
        await finish(false);
        return true;
      default:
        return false;
    }
  };

  const onMic = async () => {
    if (listenCtrl) {
      listenCtrl.abort(); // second tap while listening = cancel
      return;
    }
    const ms = mission;
    if (busy || blocked || !ms) return;
    deps.unlock();
    deps.stopSpeaking?.();
    busy = true;
    listenCtrl = new AbortController();
    refresh();
    setStatus('듣는 중… 말을 마치면 잠시 기다려 주세요.');
    try {
      mic ??= await deps.mic();
      const audio = await mic.listen({ signal: listenCtrl.signal });
      listenCtrl = null;
      refresh();
      if (audio === 'idle') {
        setStatus('');
        return;
      }
      setStatus('생각 중…');
      const typed = method === 1 ? textArea.value.trim() : undefined;
      const r = await deps.send(
        {
          scenario, mode: 'home', level: method, history: history.slice(),
          weakPhrases: (await deps.db.topWeakPhrases(5)).map((w) => ({ original: w.original, better: w.better })),
          audioWav: encodeWav(audio, CONFIG.sampleRate), typedText: typed,
          mission: ms, achieved: achieved.slice(),
        },
        apiKey,
      );
      if (await handleCommand(r)) {
        if (!closed && r.command !== 'goal') setStatus('');
        return;
      }
      if (!r.transcript.trim()) {
        setStatus('잘 못 들었어요. 다시 말해 주세요.');
        return;
      }
      const turn: TurnRec = {
        id: newId(), sessionId, idx: idx++, at: Date.now(), transcript: r.transcript, aiLine: r.aiLine,
        correction: r.correction, pronunciation: r.pronunciation,
      };
      turns.push(turn);
      userTurns++;
      if (r.correction) corrections++;
      if (!started) {
        started = true;
        await deps.db.startSession({
          id: sessionId, scenarioId: scenario.id, mode: 'home', startedAt,
          missionTitle: ms.titleKo, goals: ms.goals, difficulty: ms.difficulty,
        });
      }
      await deps.db.addTurn(turn);
      history.push({ role: 'user', text: r.transcript }, { role: 'ai', text: r.aiLine });
      last = { aiLine: r.aiLine, aiLineKo: r.aiLineKo, suggestedReply: r.suggestedReply };
      const fresh = r.goalsDone.filter((n) => n <= ms.goals.length && !achieved.includes(n));
      achieved.push(...fresh);
      renderGoals();
      chat.append(
        h('div', { className: 'bubble me' }, r.transcript,
          r.correction || r.pronunciation ? h('span', { className: 'mark', title: '끝나고 확인해요' }, '•') : null),
        aiBubble(r.aiLine),
      );
      textArea.value = '';
      hintBox.hidden = true;
      setStatus(fresh.length && achieved.length < ms.goals.length ? KO.goalOne : '');
      // The bottom bar is sticky at the end of the page, so the page bottom = newest message just above it.
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
      await say(r.aiLine);
      if (closed) return; // user left while the reply was spoken
      if (achieved.length >= ms.goals.length) await finish(true);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setStatus('');
      } else if (e instanceof RateLimitError) {
        setStatus(h('span', { className: 'error' }, '요청이 많아요. 잠시 후에 다시 눌러 주세요.'));
      } else if (e instanceof FatalApiError) {
        setStatus(
          h('span', { className: 'error' }, '앱 설정에 문제가 있어요. AI 모델 설정을 확인해 주세요.',
            h('small', { className: 'detail' }, ` (${e.message})`)),
        );
      } else if (e instanceof AuthError) {
        setStatus(h('span', { className: 'error' }, 'API 키에 문제가 있어요. ', h('a', { href: routeToHash({ name: 'settings' }) }, '설정에서 확인하기')));
      } else if (e instanceof QuotaError) {
        blocked = true;
        setStatus(h('span', { className: 'error' }, '오늘 무료 사용량이 끝났어요. 내일 다시 해 주세요.'));
      } else if (e instanceof NetworkError) {
        setStatus(h('span', { className: 'error' }, '인터넷 연결을 확인하고 다시 눌러 주세요.'));
      } else if (e instanceof BadResponseError) {
        setStatus('잘 못 들었어요. 다시 말해 주세요.');
      } else {
        setStatus(h('span', { className: 'error' }, `문제가 생겼어요: ${(e as Error).message ?? e}`));
      }
    } finally {
      listenCtrl = null;
      busy = false;
      refresh();
    }
  };
  micBtn.addEventListener('click', () => void onMic());

  const finish = async (isAchieved: boolean) => {
    const from = mission?.difficulty ?? 1;
    const change = await close(isAchieved);
    const changeText = levelChangeText(change, from);
    const items = turns.filter((t) => t.correction || t.pronunciation);
    mount(
      root,
      h('header', {}, h('a', { href: '#/', className: 'back' }, '← 홈'), h('h1', {}, isAchieved ? `🎉 ${KO.goalAll}` : '오늘의 교정')),
      mission ? h('p', { className: 'hint' }, `${mission.titleKo} · ${mission.difficulty}단계`) : null,
      changeText ? h('p', { className: 'status' }, changeText) : null,
      h(
        'section',
        { className: 'summary' },
        items.length ? null : h('p', {}, '고칠 표현이 없었어요. 잘했어요!'),
        ...items.map((t) =>
          h(
            'div',
            { className: 'item' },
            h('div', {}, `내가 한 말: ${t.transcript}`),
            t.correction ? h('div', { className: 'better' }, `더 자연스럽게: ${t.correction.better}`) : null,
            t.correction?.why ? h('div', { className: 'hint' }, t.correction.why) : null,
            t.pronunciation ? h('div', { className: 'hint' }, `발음: ${t.pronunciation}`) : null,
            t.correction ? h('button', { type: 'button', onclick: () => void say(t.correction!.better) }, '듣기') : null,
          ),
        ),
      ),
      h('button', { type: 'button', className: 'primary', onclick: restart }, '다음 목표'),
      h('p', {}, h('a', { href: '#/review' }, '전체 기록 보기')),
    );
  };

  mount(
    root,
    h('header', {}, h('a', { href: '#/', className: 'back' }, '← 홈'), h('h1', {}, scenario.titleKo)),
    goalsCard,
    h('div', { className: 'levels-label hint' }, '연습 방식'),
    levelBar,
    chat,
    h('div', { className: 'dock' }, status, hintBox, textArea, hintBtn, micBtn,
      h('button', { type: 'button', onclick: () => void finish(false) }, '대화 끝내기')),
  );
  refresh();

  const m = await deps.startMission(scenario);
  if (closed) return;
  mission = m;
  history.push({ role: 'ai', text: m.openingLine });
  last = { aiLine: m.openingLine, aiLineKo: '', suggestedReply: '' };
  renderGoals();
  chat.append(aiBubble(m.openingLine));
  busy = false;
  refresh();
}
