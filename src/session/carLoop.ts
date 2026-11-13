import { CONFIG } from '../config';
import { encodeWav } from '../audio/wav';
import type { SpeakOpts } from '../audio/speaker';
import { AuthError, BadResponseError, FatalApiError, NetworkError, QuotaError, RateLimitError } from '../ai/errors';
import type { HistoryItem, TurnRequest } from '../ai/prompt';
import type { TurnResult } from '../ai/schema';
import type { Mission } from '../missions';
import { nextScenario, type Scenario } from '../scenarios';
import type { Db } from '../store/db';
import { MAX_LEVEL, MIN_LEVEL, type LevelChange, type Outcome } from './difficulty';
import { EN_RETRY, KO } from './phrases';

export interface LoopDeps {
  /** Resolves with one utterance, or 'idle' after idleMs of silence (idleMs 0 = never). The mic is stopped when it resolves. */
  listen(opts: { signal: AbortSignal; idleMs: number }): Promise<Float32Array | 'idle'>;
  send(req: TurnRequest, signal: AbortSignal): Promise<TurnResult>;
  speak(text: string, opts: SpeakOpts): Promise<void>;
  startMission(scenario: Scenario, signal: AbortSignal): Promise<Mission>;
  finishMission(scenarioId: string, o: Outcome): Promise<LevelChange>;
  db: Pick<Db, 'addTurn' | 'endSession' | 'startSession' | 'updateSession'>;
  now(): number;
  sleep(ms: number): Promise<void>;
  newId(): string;
}

/** Conversation state kept across pause/resume. One mission = one saved session. */
export interface LoopState {
  scenario: Scenario;
  rate: number;
  mission: Mission | null;
  sessionId: string | null;
  history: HistoryItem[];
  last: { aiLine: string; aiLineKo: string; suggestedReply: string };
  idx: number;
  achieved: number[];
  userTurns: number;
  corrections: number;
  introduced: boolean; // goals + opening line were fully spoken
}

export function createLoopState(scenario: Scenario, rate: number): LoopState {
  return {
    scenario, rate, mission: null, sessionId: null, history: [],
    last: { aiLine: '', aiLineKo: '', suggestedReply: '' }, idx: 0, achieved: [], userTurns: 0, corrections: 0, introduced: false,
  };
}

export interface LoopCtx {
  scenario: Scenario;
  weakPhrases: { original: string; better: string }[];
  rate?: number;
  state?: LoopState;
}

export type LoopEnd = 'stopped' | 'quota' | 'auth' | 'error' | 'paused';

class Paused extends Error {}
class TooManyBad extends Error {}

const numbered = (goals: string[], which: number[]) => which.map((n) => `${n}번, ${goals[n - 1]}.`).join(' ');

/**
 * Ends the current mission's session. When `evaluate` is true the difficulty rules run.
 * Safe to call when no mission is active.
 */
async function closeMission(
  deps: Pick<LoopDeps, 'finishMission' | 'db' | 'now'>,
  st: LoopState,
  evaluateIt: boolean,
  achieved: boolean,
): Promise<LevelChange> {
  const { mission, sessionId } = st;
  st.mission = null;
  st.sessionId = null;
  if (!mission || !sessionId) return null;
  // all goals done counts as achieved even if we were interrupted before congratulating
  achieved = achieved || st.achieved.length >= mission.goals.length;
  let change: LevelChange = null;
  if (achieved) await deps.db.updateSession(sessionId, { achieved: true });
  if (evaluateIt) {
    change = await deps.finishMission(st.scenario.id, { achieved, userTurns: st.userTurns, corrections: st.corrections });
  }
  await deps.db.endSession(sessionId, deps.now());
  return change;
}

/** Used by the car screen's quit button: evaluates and closes the mission in progress. */
export async function closeMissionForQuit(deps: Pick<LoopDeps, 'finishMission' | 'db' | 'now'>, st: LoopState): Promise<LevelChange> {
  return closeMission(deps, st, true, false);
}

export async function runCarLoop(deps: LoopDeps, ctx: LoopCtx, signal: AbortSignal): Promise<LoopEnd> {
  const st = ctx.state ?? createLoopState(ctx.scenario, ctx.rate ?? CONFIG.ttsRate.normal);
  let badInRow = 0;

  const check = () => {
    if (signal.aborted) throw new Paused();
  };
  const en = async (text: string) => {
    check();
    await deps.speak(text, { lang: 'en-US', rate: st.rate });
  };
  const ko = async (text: string) => {
    check();
    await deps.speak(text, { lang: 'ko-KR', rate: CONFIG.ttsRate.normal });
  };
  /** Ends the loop: abnormal endings close the session without evaluating difficulty. */
  const end = async (reason: Exclude<LoopEnd, 'paused'>, phrase: string): Promise<LoopEnd> => {
    try {
      await deps.speak(phrase, { lang: 'ko-KR', rate: CONFIG.ttsRate.normal });
    } finally {
      await closeMission(deps, st, false, false);
    }
    return reason;
  };
  const announce = async (change: LevelChange, from: number) => {
    if (change === 'up') await ko(KO.levelUp(Math.min(MAX_LEVEL, from + 1)));
    if (change === 'down') await ko(KO.levelDown(Math.max(MIN_LEVEL, from - 1)));
  };
  const beginMission = async () => {
    const mission = await deps.startMission(st.scenario, signal);
    check();
    const sessionId = deps.newId();
    await deps.db.startSession({
      id: sessionId, scenarioId: st.scenario.id, mode: 'car', startedAt: deps.now(),
      missionTitle: mission.titleKo, goals: mission.goals, difficulty: mission.difficulty,
    });
    Object.assign(st, {
      mission, sessionId, idx: 0, achieved: [], userTurns: 0, corrections: 0, introduced: false,
      history: [{ role: 'ai', text: mission.openingLine }],
      last: { aiLine: mission.openingLine, aiLineKo: '', suggestedReply: '' },
    });
    await introduce();
  };
  /** Speaks the goals (Korean) and the opening line; replayed on resume if it was interrupted. */
  const introduce = async () => {
    const m = st.mission!;
    await ko(`${KO.goalIntro} ${numbered(m.goals, m.goals.map((_, i) => i + 1))}`);
    await en(m.openingLine);
    st.introduced = true;
  };
  /** Closes the current mission (evaluated) and announces any level change. */
  const finishAndAnnounce = async (achieved: boolean) => {
    const from = st.mission?.difficulty ?? 1;
    const change = await closeMission(deps, st, true, achieved);
    await announce(change, from);
  };

  // Sends one utterance; retries network errors (announced once) and rate limits (silently, capped).
  const sendWithRetry = async (req: TurnRequest): Promise<TurnResult> => {
    let netAttempt = 0;
    let rateAttempt = 0;
    let offline = false;
    const delays = CONFIG.retryDelaysMs;
    for (;;) {
      check();
      try {
        const r = await deps.send(req, signal);
        if (offline) await ko(KO.online);
        return r;
      } catch (e) {
        check();
        if (e instanceof RateLimitError) {
          if (rateAttempt >= CONFIG.maxRateLimitRetries) throw new QuotaError('rate limit did not clear');
          rateAttempt++;
          await deps.sleep(e.retryAfterMs ?? delays[delays.length - 1]);
          continue;
        }
        if (!(e instanceof NetworkError)) throw e;
        if (!offline) {
          offline = true;
          await ko(KO.offline);
        }
        await deps.sleep(delays[Math.min(netAttempt, delays.length - 1)]);
        netAttempt++;
      }
    }
  };

  try {
    let idleSpoken = false;
    for (;;) {
      check();
      if (!st.mission) await beginMission();
      else if (!st.introduced) await introduce();
      const mission = st.mission!;
      if (st.achieved.length >= mission.goals.length) {
        // resumed after the last goal was reached but before we congratulated
        await ko(KO.goalAll);
        await finishAndAnnounce(true);
        continue;
      }
      const heard = await deps.listen({ signal, idleMs: idleSpoken ? 0 : CONFIG.idlePromptMs });
      check();
      if (heard === 'idle') {
        if (!idleSpoken) {
          idleSpoken = true;
          await ko(KO.idle);
        }
        continue;
      }
      const req: TurnRequest = {
        scenario: st.scenario,
        mode: 'car',
        level: 3,
        history: st.history.slice(),
        weakPhrases: ctx.weakPhrases,
        audioWav: encodeWav(heard, CONFIG.sampleRate),
        mission,
        achieved: st.achieved.slice(),
      };

      let r: TurnResult;
      try {
        r = await sendWithRetry(req);
        badInRow = 0;
      } catch (e) {
        if (e instanceof BadResponseError) {
          badInRow++;
          if (badInRow >= CONFIG.maxConsecutiveBadResponses) throw new TooManyBad();
          await en(EN_RETRY);
          continue;
        }
        throw e;
      }

      switch (r.command) {
        case 'repeat':
          await en(st.last.aiLine);
          continue;
        case 'slower':
          st.rate = CONFIG.ttsRate.slow;
          await en(st.last.aiLine);
          continue;
        case 'korean':
          if (st.last.aiLineKo) await ko(st.last.aiLineKo);
          else await en(st.last.aiLine);
          continue;
        case 'hint':
          if (st.last.suggestedReply) {
            await ko(KO.hintIntro);
            await en(st.last.suggestedReply);
          } else {
            await en(st.last.aiLine);
          }
          continue;
        case 'goal': {
          const left = mission.goals.map((_, i) => i + 1).filter((n) => !st.achieved.includes(n));
          await ko(`${KO.goalsLeft} ${numbered(mission.goals, left)}`);
          continue;
        }
        case 'next':
          await ko(KO.newMission);
          await finishAndAnnounce(false);
          continue; // a new mission starts at the top of the loop
        case 'otherScenario':
          await ko(KO.otherScenario);
          await finishAndAnnounce(false);
          st.scenario = nextScenario(st.scenario);
          continue;
        case 'stop':
          await finishAndAnnounce(false);
          await ko(KO.stop);
          return 'stopped';
      }

      if (!r.transcript.trim()) continue;
      idleSpoken = false;
      st.userTurns++;
      if (r.correction) st.corrections++;
      st.history.push({ role: 'user', text: r.transcript }, { role: 'ai', text: r.aiLine });
      st.last = { aiLine: r.aiLine, aiLineKo: r.aiLineKo, suggestedReply: r.suggestedReply };
      await deps.db.addTurn({
        id: deps.newId(),
        sessionId: st.sessionId!,
        idx: st.idx++,
        at: deps.now(),
        transcript: r.transcript,
        aiLine: r.aiLine,
        correction: r.correction,
        pronunciation: r.pronunciation,
      });
      const fresh = r.goalsDone.filter((n) => n <= mission.goals.length && !st.achieved.includes(n));
      st.achieved.push(...fresh);
      await en(r.aiLine);
      if (st.achieved.length >= mission.goals.length) {
        await ko(KO.goalAll);
        await finishAndAnnounce(true);
      } else if (fresh.length) {
        await ko(KO.goalOne);
      }
    }
  } catch (e) {
    if (e instanceof Paused || (e instanceof DOMException && e.name === 'AbortError') || signal.aborted) return 'paused';
    if (e instanceof QuotaError) return end('quota', KO.quota);
    if (e instanceof AuthError) return end('auth', KO.auth);
    if (e instanceof FatalApiError) return end('error', KO.fatal);
    if (e instanceof TooManyBad) return end('error', KO.badRepeated);
    return end('error', KO.error);
  }
}
