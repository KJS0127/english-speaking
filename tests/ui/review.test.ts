import 'fake-indexeddb/auto';
import { openDb, type Db } from '../../src/store/db';
import { renderReview } from '../../src/ui/review';
import { findScenario } from '../../src/scenarios';

let n = 0;
let db: Db;
let speak: ReturnType<typeof vi.fn>;
const root = () => document.getElementById('root')!;
const byText = (t: string) => [...root().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === t);

beforeEach(async () => {
  document.body.innerHTML = '<div id="root"></div>';
  db = await openDb(`rv-${++n}`);
  speak = vi.fn().mockResolvedValue(undefined);
});

async function seed() {
  await db.startSession({ id: 'old', scenarioId: 'cafe-order', mode: 'home', startedAt: new Date(2026, 10, 10, 9, 0).getTime() });
  await db.startSession({ id: 'new', scenarioId: 'hotel-checkin', mode: 'car', startedAt: new Date(2026, 10, 12, 8, 30).getTime() });
  await db.addTurn({
    id: 't1', sessionId: 'new', idx: 0, at: 1, transcript: 'I have reservation', aiLine: 'Your name?',
    correction: { original: 'I have reservation', better: 'I have a reservation', why: '관사 a가 필요해요' },
    pronunciation: 'reservation의 v 발음',
  });
  await db.addTurn({ id: 't2', sessionId: 'new', idx: 1, at: 2, transcript: 'Kim', aiLine: 'Thanks', correction: null, pronunciation: null });
}

test('lists sessions newest first with date, scenario title, 집/차 badge', async () => {
  await seed();
  await renderReview(root(), { db, speak });
  const rows = [...root().querySelectorAll('.session-row')];
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain(findScenario('hotel-checkin')!.titleKo);
  expect(rows[0].textContent).toContain('차');
  expect(rows[0].textContent).toContain('11월 12일');
  expect(rows[1].textContent).toContain('집');
  expect(rows[0].querySelector('a')!.getAttribute('href')).toBe('#/review/new');
});

test('session detail shows each turn: 내가 한 말, 더 자연스러운 표현, 이유, 발음 피드백', async () => {
  await seed();
  await renderReview(root(), { db, speak }, 'new');
  const text = root().textContent!;
  expect(text).toContain('I have reservation');
  expect(text).toContain('I have a reservation');
  expect(text).toContain('관사 a가 필요해요');
  expect(text).toContain('reservation의 v 발음');
  expect(text).toContain('Your name?');
  expect(text).toContain('Kim');
});

test('better phrase has a listen button that speaks it in en-US', async () => {
  await seed();
  await renderReview(root(), { db, speak }, 'new');
  byText('듣기')!.click();
  expect(speak).toHaveBeenCalledWith('I have a reservation', expect.objectContaining({ lang: 'en-US' }));
});

test('listen button uses the saved voice rate', async () => {
  await seed();
  await db.setSetting('ttsRate', 0.75);
  await renderReview(root(), { db, speak }, 'new');
  byText('듣기')!.click();
  expect(speak).toHaveBeenCalledWith('I have a reservation', { lang: 'en-US', rate: 0.75 });
});

test('자주 틀린 표현 tab lists top weak phrases with counts', async () => {
  await seed();
  await db.addTurn({
    id: 't3', sessionId: 'old', idx: 0, at: 3, transcript: 'x', aiLine: 'y',
    correction: { original: 'I have reservation', better: 'I have a reservation', why: '' }, pronunciation: null,
  });
  await renderReview(root(), { db, speak });
  byText('자주 틀린 표현')!.click();
  await new Promise((r) => setTimeout(r, 20));
  const text = root().textContent!;
  expect(text).toContain('I have a reservation');
  expect(text).toContain('2번');
});

test('empty state shows 아직 연습 기록이 없어요', async () => {
  await renderReview(root(), { db, speak });
  expect(root().textContent).toContain('아직 연습 기록이 없어요');
});

test('unknown session id shows not-found message', async () => {
  await renderReview(root(), { db, speak }, 'missing');
  expect(root().textContent).toContain('기록을 찾을 수 없어요');
});

test('mission sessions show the mission title, level and an achieved mark', async () => {
  await db.startSession({
    id: 'm', scenarioId: 'cafe-order', mode: 'car', startedAt: 5, missionTitle: '라테 주문 미션', goals: ['라테 주문하기'], difficulty: 3,
  });
  await db.updateSession('m', { achieved: true });
  await renderReview(root(), { db, speak });
  const row = root().querySelector('.session-row')!;
  expect(row.textContent).toContain('라테 주문 미션');
  expect(row.textContent).toContain('✓');
  await renderReview(root(), { db, speak }, 'm');
  expect(root().textContent).toContain('라테 주문하기');
  expect(root().textContent).toContain('3단계');
});
