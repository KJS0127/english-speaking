import 'fake-indexeddb/auto';
import { openDb, BackupError, type TurnRec } from '../../src/store/db';

let n = 0;
const fresh = () => openDb(`test-${++n}`);
const turn = (over: Partial<TurnRec> = {}): TurnRec => ({
  id: `t${Math.random()}`, sessionId: 's1', idx: 0, at: 1000, transcript: 'I want coffee', aiLine: 'Sure',
  correction: null, pronunciation: null, ...over,
});
const corr = { original: 'I want coffee', better: "I'd like a coffee", why: '공손' };

test('addTurn with correction creates weak phrase and increments on repeat', async () => {
  const db = await fresh();
  await db.addTurn(turn({ correction: corr, at: 1 }));
  await db.addTurn(turn({ correction: { ...corr, better: " I'D LIKE A COFFEE " }, at: 2 }));
  const top = await db.topWeakPhrases(10);
  expect(top).toHaveLength(1);
  expect(top[0].count).toBe(2);
  expect(top[0].lastSeen).toBe(2);
});

test('addTurn without correction creates no weak phrase', async () => {
  const db = await fresh();
  await db.addTurn(turn());
  expect(await db.topWeakPhrases(10)).toHaveLength(0);
});

test('topWeakPhrases orders by count desc then lastSeen desc', async () => {
  const db = await fresh();
  await db.addTurn(turn({ correction: { ...corr, better: 'A' }, at: 1 }));
  await db.addTurn(turn({ correction: { ...corr, better: 'B' }, at: 5 }));
  await db.addTurn(turn({ correction: { ...corr, better: 'C' }, at: 2 }));
  await db.addTurn(turn({ correction: { ...corr, better: 'C' }, at: 3 }));
  expect((await db.topWeakPhrases(3)).map((w) => w.better)).toEqual(['C', 'B', 'A']);
  expect(await db.topWeakPhrases(1)).toHaveLength(1);
});

test('listSessions newest first; getTurns ordered by idx', async () => {
  const db = await fresh();
  await db.startSession({ id: 'a', scenarioId: 'cafe-order', mode: 'home', startedAt: 1 });
  await db.startSession({ id: 'b', scenarioId: 'cafe-order', mode: 'car', startedAt: 2 });
  await db.endSession('a', 10);
  const s = await db.listSessions();
  expect(s.map((x) => x.id)).toEqual(['b', 'a']);
  expect(s[1].endedAt).toBe(10);
  expect(s[0].endedAt).toBeNull();
  await db.addTurn(turn({ sessionId: 'a', idx: 1, id: 'x1' }));
  await db.addTurn(turn({ sessionId: 'a', idx: 0, id: 'x0' }));
  await db.addTurn(turn({ sessionId: 'b', idx: 0, id: 'y0' }));
  expect((await db.getTurns('a')).map((t) => t.id)).toEqual(['x0', 'x1']);
});

test('settings round-trip', async () => {
  const db = await fresh();
  expect(await db.getSetting('apiKey')).toBeUndefined();
  await db.setSetting('apiKey', 'K');
  expect(await db.getSetting<string>('apiKey')).toBe('K');
});

test('exportBackup excludes settings', async () => {
  const db = await fresh();
  await db.setSetting('apiKey', 'SECRET-KEY');
  await db.startSession({ id: 'a', scenarioId: 'x', mode: 'home', startedAt: 1 });
  const json = await db.exportBackup();
  expect(json).not.toContain('SECRET-KEY');
  expect(JSON.parse(json).version).toBe(1);
});

test('export then import into fresh db restores sessions, turns, weakPhrases', async () => {
  const a = await fresh();
  await a.startSession({ id: 's1', scenarioId: 'x', mode: 'car', startedAt: 1 });
  await a.addTurn(turn({ id: 't1', correction: corr }));
  const json = await a.exportBackup();
  const b = await fresh();
  await b.startSession({ id: 'old', scenarioId: 'x', mode: 'home', startedAt: 0 });
  await b.importBackup(json);
  expect((await b.listSessions()).map((s) => s.id)).toEqual(['s1']);
  expect((await b.getTurns('s1')).map((t) => t.id)).toEqual(['t1']);
  expect(await b.topWeakPhrases(5)).toHaveLength(1);
});

test('importBackup with invalid file keeps existing data', async () => {
  const db = await fresh();
  await db.startSession({ id: 'keep', scenarioId: 'x', mode: 'home', startedAt: 1 });
  await expect(db.importBackup('{"version":1,"sessions":"x"}')).rejects.toBeInstanceOf(BackupError);
  await expect(db.importBackup('not json')).rejects.toBeInstanceOf(BackupError);
  await expect(db.importBackup('{"version":2,"sessions":[],"turns":[],"weakPhrases":[]}')).rejects.toBeInstanceOf(BackupError);
  await expect(
    db.importBackup('{"version":1,"sessions":[{"id":1}],"turns":[],"weakPhrases":[]}'),
  ).rejects.toBeInstanceOf(BackupError);
  expect((await db.listSessions()).map((s) => s.id)).toEqual(['keep']);
});
