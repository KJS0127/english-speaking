import { CONFIG } from '../config';
import type { SpeakOpts } from '../audio/speaker';
import { findScenario } from '../scenarios';
import type { Db, SessionRec } from '../store/db';
import { h, mount } from './dom';
import { routeToHash } from './router';

export interface ReviewDeps {
  db: Db;
  speak: (text: string, opts: SpeakOpts) => Promise<void>;
}

const fmtDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const title = (s: SessionRec) => s.missionTitle ?? findScenario(s.scenarioId)?.titleKo ?? s.scenarioId;

export async function renderReview(root: HTMLElement, deps: ReviewDeps, sessionId?: string): Promise<void> {
  const rate = (await deps.db.getSetting<number>('ttsRate')) ?? CONFIG.ttsRate.normal;
  const listen = (text: string) =>
    h('button', { type: 'button', onclick: () => void deps.speak(text, { lang: 'en-US', rate }) }, '듣기');

  if (sessionId) {
    const session = (await deps.db.listSessions()).find((s) => s.id === sessionId);
    if (!session) {
      mount(root, h('header', {}, h('a', { href: '#/review' }, '← 복습'), h('h1', {}, '복습')), h('p', { className: 'empty' }, '기록을 찾을 수 없어요.'));
      return;
    }
    const turns = await deps.db.getTurns(sessionId);
    mount(
      root,
      h('header', {}, h('a', { href: '#/review' }, '← 복습'), h('h1', {}, title(session))),
      h('p', { className: 'hint' }, `${fmtDate(session.startedAt)} · ${session.mode === 'car' ? '차' : '집'}${session.difficulty ? ` · ${session.difficulty}단계` : ''}${session.achieved ? ' · 목표 달성 ✓' : ''}`),
      session.goals?.length ? h('ul', { className: 'goals-list' }, ...session.goals.map((g) => h('li', {}, g))) : null,
      turns.length
        ? h(
            'section',
            { className: 'summary' },
            ...turns.map((t) =>
              h(
                'div',
                { className: 'item' },
                h('div', {}, `내가 한 말: ${t.transcript}`),
                t.correction ? h('div', { className: 'better' }, `더 자연스럽게: ${t.correction.better} `, listen(t.correction.better)) : null,
                t.correction?.why ? h('div', { className: 'hint' }, `이유: ${t.correction.why}`) : null,
                t.pronunciation ? h('div', { className: 'hint' }, `발음: ${t.pronunciation}`) : null,
                h('div', { className: 'hint' }, `AI: ${t.aiLine}`),
              ),
            ),
          )
        : h('p', { className: 'empty' }, '이 대화에는 기록된 말이 없어요.'),
    );
    return;
  }

  const body = h('div', {});
  const tabSessions = h('button', { type: 'button', 'aria-pressed': 'true' }, '대화 기록');
  const tabWeak = h('button', { type: 'button', 'aria-pressed': 'false' }, '자주 틀린 표현');

  const showSessions = async () => {
    tabSessions.setAttribute('aria-pressed', 'true');
    tabWeak.setAttribute('aria-pressed', 'false');
    const sessions = await deps.db.listSessions();
    body.replaceChildren(
      ...(sessions.length
        ? sessions.map((s) =>
            h(
              'div',
              { className: 'card session-row' },
              h('a', { href: routeToHash({ name: 'review', sessionId: s.id }) }, s.achieved ? `✓ ${title(s)}` : title(s)),
              h('span', {}, h('span', { className: 'hint' }, `${fmtDate(s.startedAt)} `), h('span', { className: 'badge' }, s.mode === 'car' ? '차' : '집')),
            ),
          )
        : [h('p', { className: 'empty' }, '아직 연습 기록이 없어요.')]),
    );
  };

  const showWeak = async () => {
    tabSessions.setAttribute('aria-pressed', 'false');
    tabWeak.setAttribute('aria-pressed', 'true');
    const weak = await deps.db.topWeakPhrases(20);
    body.replaceChildren(
      ...(weak.length
        ? weak.map((w) =>
            h(
              'div',
              { className: 'card' },
              h('div', { className: 'better' }, w.better, ' ', listen(w.better)),
              h('div', { className: 'hint' }, `내가 한 말: ${w.original} · ${w.count}번`),
            ),
          )
        : [h('p', { className: 'empty' }, '아직 자주 틀린 표현이 없어요.')]),
    );
  };

  tabSessions.addEventListener('click', () => void showSessions());
  tabWeak.addEventListener('click', () => void showWeak());
  mount(root, h('header', {}, h('a', { href: '#/' }, '← 홈'), h('h1', {}, '복습')), h('div', { className: 'tabs' }, tabSessions, tabWeak), body);
  await showSessions();
}
