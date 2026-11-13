import { openDB, type IDBPDatabase } from 'idb';
import type { Correction } from '../ai/schema';

export interface SessionRec {
  id: string;
  scenarioId: string;
  mode: 'home' | 'car';
  startedAt: number;
  endedAt: number | null;
}

export interface TurnRec {
  id: string;
  sessionId: string;
  idx: number;
  at: number;
  transcript: string;
  aiLine: string;
  correction: Correction | null;
  pronunciation: string | null;
}

export interface WeakPhrase {
  key: string; // normalized `better`
  original: string;
  better: string;
  count: number;
  lastSeen: number;
}

export class BackupError extends Error {
  name = 'BackupError';
}

export interface Db {
  startSession(s: Omit<SessionRec, 'endedAt'>): Promise<void>;
  endSession(id: string, at: number): Promise<void>;
  addTurn(t: TurnRec): Promise<void>;
  listSessions(): Promise<SessionRec[]>;
  getTurns(sessionId: string): Promise<TurnRec[]>;
  topWeakPhrases(n: number): Promise<WeakPhrase[]>;
  getSetting<T>(key: string): Promise<T | undefined>;
  setSetting(key: string, value: unknown): Promise<void>;
  exportBackup(): Promise<string>;
  importBackup(json: string): Promise<void>;
}

const keyOf = (better: string) => better.trim().toLowerCase();

const isStr = (v: unknown) => typeof v === 'string';
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

function validateBackup(json: string): { sessions: SessionRec[]; turns: TurnRec[]; weakPhrases: WeakPhrase[] } {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new BackupError('not JSON');
  }
  if (!data || data.version !== 1) throw new BackupError('unsupported version');
  const { sessions, turns, weakPhrases } = data;
  if (!Array.isArray(sessions) || !Array.isArray(turns) || !Array.isArray(weakPhrases)) throw new BackupError('bad shape');
  const okSession = (s: any) =>
    s && isStr(s.id) && isStr(s.scenarioId) && (s.mode === 'home' || s.mode === 'car') && isNum(s.startedAt) &&
    (s.endedAt === null || isNum(s.endedAt));
  const okTurn = (t: any) =>
    t && isStr(t.id) && isStr(t.sessionId) && isNum(t.idx) && isNum(t.at) && isStr(t.transcript) && isStr(t.aiLine);
  const okWeak = (w: any) => w && isStr(w.key) && isStr(w.better) && isStr(w.original) && isNum(w.count) && isNum(w.lastSeen);
  if (!sessions.every(okSession) || !turns.every(okTurn) || !weakPhrases.every(okWeak)) throw new BackupError('bad record');
  return { sessions, turns, weakPhrases };
}

export async function openDb(name = 'speaking-practice'): Promise<Db> {
  const idb: IDBPDatabase = await openDB(name, 1, {
    upgrade(db) {
      db.createObjectStore('sessions', { keyPath: 'id' });
      const turns = db.createObjectStore('turns', { keyPath: 'id' });
      turns.createIndex('bySession', 'sessionId');
      db.createObjectStore('weakPhrases', { keyPath: 'key' });
      db.createObjectStore('settings');
    },
  });

  return {
    async startSession(s) {
      await idb.put('sessions', { ...s, endedAt: null });
    },
    async endSession(id, at) {
      const tx = idb.transaction('sessions', 'readwrite');
      const s = await tx.store.get(id);
      if (s) await tx.store.put({ ...s, endedAt: at });
      await tx.done;
    },
    async addTurn(t) {
      const tx = idb.transaction(['turns', 'weakPhrases'], 'readwrite');
      await tx.objectStore('turns').put(t);
      if (t.correction) {
        const key = keyOf(t.correction.better);
        const weak = tx.objectStore('weakPhrases');
        const prev = (await weak.get(key)) as WeakPhrase | undefined;
        await weak.put({
          key,
          original: t.correction.original,
          better: t.correction.better.trim(),
          count: (prev?.count ?? 0) + 1,
          lastSeen: Math.max(prev?.lastSeen ?? 0, t.at),
        });
      }
      await tx.done;
    },
    async listSessions() {
      const all = (await idb.getAll('sessions')) as SessionRec[];
      return all.sort((a, b) => b.startedAt - a.startedAt);
    },
    async getTurns(sessionId) {
      const all = (await idb.getAllFromIndex('turns', 'bySession', sessionId)) as TurnRec[];
      return all.sort((a, b) => a.idx - b.idx);
    },
    async topWeakPhrases(n) {
      const all = (await idb.getAll('weakPhrases')) as WeakPhrase[];
      return all.sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen).slice(0, n);
    },
    async getSetting<T>(key: string) {
      return (await idb.get('settings', key)) as T | undefined;
    },
    async setSetting(key, value) {
      await idb.put('settings', value, key);
    },
    async exportBackup() {
      const [sessions, turns, weakPhrases] = await Promise.all([
        idb.getAll('sessions'),
        idb.getAll('turns'),
        idb.getAll('weakPhrases'),
      ]);
      return JSON.stringify({ version: 1, exportedAt: Date.now(), sessions, turns, weakPhrases });
    },
    async importBackup(json) {
      const data = validateBackup(json);
      const tx = idb.transaction(['sessions', 'turns', 'weakPhrases'], 'readwrite');
      await Promise.all([
        tx.objectStore('sessions').clear(),
        tx.objectStore('turns').clear(),
        tx.objectStore('weakPhrases').clear(),
      ]);
      for (const s of data.sessions) await tx.objectStore('sessions').put(s);
      for (const t of data.turns) await tx.objectStore('turns').put(t);
      for (const w of data.weakPhrases) await tx.objectStore('weakPhrases').put(w);
      await tx.done;
    },
  };
}
