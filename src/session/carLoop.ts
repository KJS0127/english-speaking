import { CONFIG } from '../config';
import { encodeWav } from '../audio/wav';
import type { SpeakOpts } from '../audio/speaker';
import { AuthError, BadResponseError, FatalApiError, NetworkError, QuotaError, RateLimitError } from '../ai/errors';
import type { HistoryItem, TurnRequest } from '../ai/prompt';
import type { TurnResult } from '../ai/schema';
import { nextScenario, type Scenario } from '../scenarios';
import type { Db } from '../store/db';
import { EN_RETRY, KO } from './phrases';

export interface LoopDeps {
  /** Resolves with one utterance, or 'idle' after idleMs of silence (idleMs 0 = never). The mic is stopped when it resolves. */
  listen(opts: { signal: AbortSignal; idleMs: number }): Promise<Float32Array | 'idle'>;
  send(req: TurnRequest, signal: AbortSignal): Promise<TurnResult>;
  speak(text: string, opts: SpeakOpts): Promise<void>;
  db: Pick<Db, 'addTurn' | 'endSession'>;
  now(): number;
  sleep(ms: number): Promise<void>;
  newId(): string;
}

/** Conversation state kept across pause/resume of the same session. */
export interface LoopState {
  scenario: Scenario;
  history: HistoryItem[];
  last: { aiLine: string; aiLineKo: string; suggestedReply: string };
  idx: number;
  rate: number;
  opened: boolean;
}

export function createLoopState(scenario: Scenario, rate: number): LoopState {
  return { scenario, history: [], last: { aiLine: '', aiLineKo: '', suggestedReply: '' }, idx: 0, rate, opened: false };
}

export interface LoopCtx {
  sessionId: string;
  scenario: Scenario;
  weakPhrases: { original: string; better: string }[];
  rate?: number;
  state?: LoopState;
}

export type LoopEnd = 'stopped' | 'quota' | 'auth' | 'error' | 'paused';

class Paused extends Error {}
class TooManyBad extends Error {}

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
  const end = async (reason: Exclude<LoopEnd, 'paused'>, phrase: string): Promise<LoopEnd> => {
    try {
      await deps.speak(phrase, { lang: 'ko-KR', rate: CONFIG.ttsRate.normal });
    } finally {
      await deps.db.endSession(ctx.sessionId, deps.now());
    }
    return reason;
  };
  const open = async () => {
    st.history = [{ role: 'ai', text: st.scenario.openingLine }];
    st.last = { aiLine: st.scenario.openingLine, aiLineKo: '', suggestedReply: '' };
    st.opened = true;
    await en(st.scenario.openingLine);
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
    if (!st.opened) await open();
    let idleSpoken = false;
    for (;;) {
      check();
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
        case 'next':
          await ko(KO.next);
          st.scenario = nextScenario(st.scenario);
          await open();
          continue;
        case 'stop':
          return await end('stopped', KO.stop);
      }

      if (!r.transcript.trim()) continue;
      idleSpoken = false;
      st.history.push({ role: 'user', text: r.transcript }, { role: 'ai', text: r.aiLine });
      st.last = { aiLine: r.aiLine, aiLineKo: r.aiLineKo, suggestedReply: r.suggestedReply };
      await deps.db.addTurn({
        id: deps.newId(),
        sessionId: ctx.sessionId,
        idx: st.idx++,
        at: deps.now(),
        transcript: r.transcript,
        aiLine: r.aiLine,
        correction: r.correction,
        pronunciation: r.pronunciation,
      });
      await en(r.aiLine);
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
