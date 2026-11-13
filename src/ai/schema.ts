import { BadResponseError } from './errors';

export type Command = 'none' | 'repeat' | 'slower' | 'korean' | 'hint' | 'next' | 'stop';
export const COMMANDS: readonly Command[] = ['none', 'repeat', 'slower', 'korean', 'hint', 'next', 'stop'];

export interface Correction {
  original: string;
  better: string;
  why: string; // Korean
}

export interface TurnResult {
  transcript: string;
  command: Command;
  aiLine: string;
  aiLineKo: string;
  suggestedReply: string;
  correction: Correction | null;
  pronunciation: string | null; // Korean explanation
}

// Gemini responseJsonSchema (JSON Schema subset; nullable = type array with 'null')
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    transcript: { type: 'string', description: 'Exactly what the learner said (verbatim, may be empty).' },
    command: { type: 'string', enum: [...COMMANDS] },
    aiLine: { type: 'string', description: 'Your next line in the role-play, in English.' },
    aiLineKo: { type: 'string', description: 'Korean meaning of aiLine.' },
    suggestedReply: { type: 'string', description: 'An easy English reply the learner could say next.' },
    correction: {
      type: ['object', 'null'],
      properties: {
        original: { type: 'string' },
        better: { type: 'string' },
        why: { type: 'string', description: 'Short reason in Korean.' },
      },
      required: ['original', 'better', 'why'],
    },
    pronunciation: { type: ['string', 'null'], description: 'Short pronunciation tip in Korean, or null.' },
  },
  required: ['transcript', 'command', 'aiLine', 'aiLineKo', 'suggestedReply', 'correction', 'pronunciation'],
} as const;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function parseTurnResult(raw: unknown): TurnResult {
  if (!raw || typeof raw !== 'object') throw new BadResponseError('response is not an object');
  const r = raw as Record<string, unknown>;
  if (typeof r.aiLine !== 'string' || !r.aiLine.trim()) throw new BadResponseError('missing aiLine');
  const command = COMMANDS.includes(r.command as Command) ? (r.command as Command) : 'none';
  let correction: Correction | null = null;
  const c = r.correction as Record<string, unknown> | null | undefined;
  if (c && typeof c === 'object' && typeof c.better === 'string' && typeof c.original === 'string' && c.better.trim()) {
    correction = { original: c.original, better: c.better, why: str(c.why) };
  }
  return {
    transcript: str(r.transcript),
    command,
    aiLine: r.aiLine,
    aiLineKo: str(r.aiLineKo),
    suggestedReply: str(r.suggestedReply),
    correction,
    pronunciation: typeof r.pronunciation === 'string' && r.pronunciation.trim() ? r.pronunciation : null,
  };
}
