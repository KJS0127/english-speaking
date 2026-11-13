import { CONFIG } from '../config';
import { encodeWav } from '../audio/wav';
import type { SpeakOpts } from '../audio/speaker';
import { AuthError, BadResponseError, NetworkError, QuotaError } from '../ai/errors';
import type { HistoryItem, TurnRequest } from '../ai/prompt';
import type { TurnResult } from '../ai/schema';
import { nextScenario, type Scenario } from '../scenarios';
import type { Db } from '../store/db';
import { EN_RETRY, KO } from './phrases';

export interface LoopDeps {
  listen(opts: { signal: AbortSignal; idleMs: number; onIdle: () => void }): Promise<Float32Array>;
  send(req: TurnRequest): Promise<TurnResult>;
  speak(text: string, opts: SpeakOpts): Promise<void>;
  db: Pick<Db, 'addTurn' | 'endSession'>;
  now(): number;
  sleep(ms: number): Promise<void>;
  newId(): string;
}

export interface LoopCtx {
  sessionId: string;
  scenario: Scenario;
  weakPhrases: { original: string; better: string }[];
}

export type LoopEnd = 'stopped' | 'quota' | 'auth' | 'paused';

class Paused extends Error {}

export async function runCarLoop(deps: LoopDeps, ctx: LoopCtx, signal: AbortSignal): Promise<LoopEnd> {
  let scenario = ctx.scenario;
  let rate: number = CONFIG.ttsRate.normal;
  let history: HistoryItem[] = [];
  let last = { aiLine: '', aiLineKo: '', suggestedReply: '' };
  let idx = 0;

  const check = () => {
    if (signal.aborted) throw new Paused();
  };
  const en = async (text: string) => {
    check();
    await deps.speak(text, { lang: 'en-US', rate });
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
    history = [{ role: 'ai', text: scenario.openingLine }];
    last = { aiLine: scenario.openingLine, aiLineKo: '', suggestedReply: '' };
    await en(scenario.openingLine);
  };

  // Sends one utterance, retrying on network errors until it gets through or the loop is paused.
  const sendWithRetry = async (req: TurnRequest): Promise<TurnResult> => {
    let attempt = 0;
    let offline = false;
    for (;;) {
      check();
      try {
        const r = await deps.send(req);
        if (offline) await ko(KO.online);
        return r;
      } catch (e) {
        if (!(e instanceof NetworkError)) throw e;
        if (!offline) {
          offline = true;
          await ko(KO.offline);
        }
        const delays = CONFIG.retryDelaysMs;
        await deps.sleep(delays[Math.min(attempt, delays.length - 1)]);
        attempt++;
      }
    }
  };

  try {
    await open();
    for (;;) {
      check();
      let idleSpoken = false;
      const audio = await deps.listen({
        signal,
        idleMs: CONFIG.idlePromptMs,
        onIdle: () => {
          if (idleSpoken) return;
          idleSpoken = true;
          void deps.speak(KO.idle, { lang: 'ko-KR', rate: CONFIG.ttsRate.normal });
        },
      });
      check();
      const req: TurnRequest = {
        scenario,
        mode: 'car',
        level: 3,
        history: history.slice(),
        weakPhrases: ctx.weakPhrases,
        audioWav: encodeWav(audio, CONFIG.sampleRate),
      };

      let r: TurnResult;
      try {
        r = await sendWithRetry(req);
      } catch (e) {
        if (e instanceof BadResponseError) {
          await en(EN_RETRY);
          continue;
        }
        throw e;
      }

      switch (r.command) {
        case 'repeat':
          await en(last.aiLine);
          continue;
        case 'slower':
          rate = CONFIG.ttsRate.slow;
          await en(last.aiLine);
          continue;
        case 'korean':
          if (last.aiLineKo) await ko(last.aiLineKo);
          else await en(last.aiLine);
          continue;
        case 'hint':
          if (last.suggestedReply) {
            await ko(KO.hintIntro);
            await en(last.suggestedReply);
          } else {
            await en(last.aiLine);
          }
          continue;
        case 'next':
          await ko(KO.next);
          scenario = nextScenario(scenario);
          await open();
          continue;
        case 'stop':
          return await end('stopped', KO.stop);
      }

      if (!r.transcript.trim()) continue;
      history.push({ role: 'user', text: r.transcript }, { role: 'ai', text: r.aiLine });
      last = { aiLine: r.aiLine, aiLineKo: r.aiLineKo, suggestedReply: r.suggestedReply };
      await deps.db.addTurn({
        id: deps.newId(),
        sessionId: ctx.sessionId,
        idx: idx++,
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
    return end('stopped', KO.error);
  }
}
