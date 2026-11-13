import 'fake-indexeddb/auto';
import { openDb } from '../../src/store/db';
import { renderSettings, PRIVACY_NOTICE } from '../../src/ui/settings';
import { renderHome } from '../../src/ui/home';
import { parseRoute, routeToHash } from '../../src/ui/router';
import { SCENARIOS } from '../../src/scenarios';

let n = 0;
const fresh = () => openDb(`ui-${++n}`);
const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  location.hash = '';
});
const root = () => document.getElementById('root')!;

test('routes round-trip through the hash', () => {
  for (const r of [
    { name: 'home' }, { name: 'settings' }, { name: 'homeMode', scenarioId: 'cafe-order' },
    { name: 'carMode', scenarioId: 'hotel-checkin' }, { name: 'review' }, { name: 'review', sessionId: 'abc' },
  ] as const) {
    expect(parseRoute(routeToHash(r))).toEqual(r);
  }
  expect(parseRoute('#/garbage')).toEqual({ name: 'home' });
  expect(parseRoute('')).toEqual({ name: 'home' });
});

test('settings saves trimmed api key', async () => {
  const db = await fresh();
  await renderSettings(root(), db);
  const input = root().querySelector<HTMLInputElement>('input[name="apiKey"]')!;
  input.value = '  KEY  ';
  root().querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  expect(await db.getSetting('apiKey')).toBe('KEY');
});

test('settings saves speech rate', async () => {
  const db = await fresh();
  await renderSettings(root(), db);
  const rate = root().querySelector<HTMLInputElement>('input[name="ttsRate"]')!;
  rate.value = '0.8';
  root().querySelector<HTMLInputElement>('input[name="apiKey"]')!.value = 'K';
  root().querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  expect(await db.getSetting('ttsRate')).toBe(0.8);
});

test('settings shows free-tier privacy notice', async () => {
  await renderSettings(root(), await fresh());
  expect(PRIVACY_NOTICE).toBe('Gemini 무료 등급은 입력 내용이 구글 서비스 개선에 쓰일 수 있어요. 개인정보는 말하지 마세요.');
  expect(root().textContent).toContain(PRIVACY_NOTICE);
});

test('settings shows enhanced voice download guide', async () => {
  await renderSettings(root(), await fresh());
  expect(root().textContent).toContain('설정 → 손쉬운 사용 → 읽기 및 말하기 → 음성');
});

test('settings shows backup export and import controls', async () => {
  await renderSettings(root(), await fresh());
  expect(root().querySelector('[data-action="export"]')).not.toBeNull();
  expect(root().querySelector('input[type="file"][name="import"]')).not.toBeNull();
});

test('invalid backup import shows message and keeps data', async () => {
  const db = await fresh();
  await db.startSession({ id: 'keep', scenarioId: 'x', mode: 'home', startedAt: 1 });
  await renderSettings(root(), db);
  const file = new File(['not json'], 'b.json', { type: 'application/json' });
  const input = root().querySelector<HTMLInputElement>('input[name="import"]')!;
  Object.defineProperty(input, 'files', { value: [file] });
  input.dispatchEvent(new Event('change'));
  await flush();
  await flush();
  expect(root().textContent).toContain('백업 파일을 읽을 수 없어요. 기존 기록은 그대로예요.');
  expect((await db.listSessions()).map((s) => s.id)).toEqual(['keep']);
});

test('home redirects to settings when api key missing', async () => {
  await renderHome(root(), await fresh());
  expect(location.hash).toBe('#/settings');
});

test('home lists categories with scenarios and two mode buttons', async () => {
  const db = await fresh();
  await db.setSetting('apiKey', 'K');
  await renderHome(root(), db);
  const text = root().textContent!;
  for (const label of ['일상', '여행', '비즈니스', '자유 대화']) expect(text).toContain(label);
  for (const s of SCENARIOS) expect(text).toContain(s.titleKo);
  const cafe = root().querySelector<HTMLElement>('[data-scenario="cafe-order"]')!;
  expect(cafe.querySelector('a[href="#/home/cafe-order"]')!.textContent).toBe('집에서 연습');
  expect(cafe.querySelector('a[href="#/car/cafe-order"]')!.textContent).toBe('차에서 연습');
  expect(root().querySelector('a[href="#/review"]')).not.toBeNull();
});
