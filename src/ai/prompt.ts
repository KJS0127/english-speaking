import type { Scenario } from '../scenarios';
import { DIFFICULTY_DESC, type Mission } from '../missions';
import { RESPONSE_SCHEMA } from './schema';

export interface HistoryItem {
  role: 'user' | 'ai';
  text: string;
}

export interface TurnRequest {
  scenario: Scenario;
  mode: 'home' | 'car';
  level: 1 | 2 | 3;
  history: HistoryItem[];
  weakPhrases: { original: string; better: string }[];
  audioWav: Uint8Array;
  typedText?: string;
  mission?: Mission;
  achieved?: number[]; // 1-based goal numbers already achieved
}

const LEVEL_DESC: Record<1 | 2 | 3, string> = {
  1: 'level 1 (the learner writes the sentence first, then says it)',
  2: 'level 2 (the learner may look at hints)',
  3: 'level 3 (the learner speaks without help)',
};

export function buildSystemPrompt(req: TurnRequest): string {
  const lines = [
    'You are an English speaking-practice partner for a Korean adult.',
    'The learner can write English fairly well but has almost no speaking experience.',
    `Role-play: ${req.scenario.setupEn}`,
    `Practice ${LEVEL_DESC[req.level]}.`,
    '',
    'Each turn you receive the learner\'s voice recording. Do all of this in ONE JSON response:',
    '- transcript: write exactly what the learner said. If nothing intelligible was said, use "".',
    '- aiLine: stay in your role and reply naturally in simple, clear English. Keep the conversation going with a question.',
    '- aiLineKo: the Korean meaning of aiLine.',
    '- suggestedReply: one easy English sentence the learner could say next.',
    '- correction: only if the learner\'s sentence was wrong or unnatural, give {original, better, why}. "why" is a short Korean explanation. Otherwise null. Never put corrections inside aiLine.',
    '- pronunciation: only if a word was clearly mispronounced, a short Korean tip (e.g. which sound). Otherwise null.',
    '- command: detect if the learner gave a control command instead of answering:',
    '  repeat = "다시", "다시 말해줘", "repeat", "say that again"',
    '  slower = "천천히", "slower", "slowly please"',
    '  korean = "한국어로", "in Korean", "무슨 뜻이야"',
    '  hint = "힌트", "hint", "help me"',
    '  next = "다음", "다음 목표", "next" (give up this mission, start a new one)',
    '  otherScenario = "다른 상황", "different situation"',
    '  goal = "목표", "goal", "what\'s my goal"',
    '  stop = "그만", "끝", "stop"',
    '  Otherwise "none". When command is not "none", still fill aiLine with a short acknowledgement.',
  ];
  if (req.mission) {
    const done = new Set(req.achieved ?? []);
    lines.push(
      '',
      `Difficulty ${req.mission.difficulty} of 5: ${DIFFICULTY_DESC[req.mission.difficulty] ?? ''}`,
      `This conversation's situation: ${req.mission.situationEn}`,
      'The learner has these goals (numbered):',
      ...req.mission.goals.map((g, i) => `${i + 1}. [${done.has(i + 1) ? 'done' : 'todo'}] ${g}`),
      '- goalsDone: list the numbers of [todo] goals the learner clearly achieved in THIS turn (else []).',
      '- Steer the conversation naturally toward the remaining goals, staying in role. If the learner drifts, bring them back.',
      '- Never say the learner\'s line for them in aiLine. suggestedReply should help with a remaining goal.',
      '- When the last remaining goal is achieved in this turn, wrap up the conversation politely in aiLine.',
    );
  }
  if (req.mode === 'car') {
    lines.push('', 'The learner is driving. aiLine must be at most 2 short sentences. Be calm and never rush the learner.');
  }
  if (req.weakPhrases.length) {
    lines.push('', 'The learner often gets these wrong. Naturally create chances to use the better forms:');
    for (const p of req.weakPhrases) lines.push(`- "${p.original}" → "${p.better}"`);
  }
  return lines.join('\n');
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

export function buildBody(req: TurnRequest): object {
  const contents = req.history.map((h) => ({
    role: h.role === 'ai' ? 'model' : 'user',
    parts: [{ text: h.text }],
  }));
  const parts: object[] = [];
  if (req.typedText?.trim()) parts.push({ text: `Intended sentence: ${req.typedText.trim()}` });
  parts.push({ inlineData: { mimeType: 'audio/wav', data: toBase64(req.audioWav) } });
  contents.push({ role: 'user', parts } as (typeof contents)[number]);
  return {
    systemInstruction: { parts: [{ text: buildSystemPrompt(req) }] },
    contents,
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: RESPONSE_SCHEMA },
  };
}
