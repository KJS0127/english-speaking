import { goalCountRange, DIFFICULTY_DESC, type Mission } from '../missions';
import type { Scenario } from '../scenarios';
import { BadResponseError } from './errors';
import { callGemini } from './gemini';

const MISSION_SCHEMA = {
  type: 'object',
  properties: {
    titleKo: { type: 'string', description: 'Short Korean title of this mission.' },
    goals: { type: 'array', items: { type: 'string' }, description: 'Concrete goals in Korean, each one sentence.' },
    situationEn: { type: 'string', description: 'English setting/twist for the role-play partner.' },
    openingLine: { type: 'string', description: "The partner's first line in English." },
  },
  required: ['titleKo', 'goals', 'situationEn', 'openingLine'],
} as const;

export function buildMissionBody(scenario: Scenario, difficulty: number, recentTitles: string[]): object {
  const [min, max] = goalCountRange(difficulty);
  const count = min === max ? `${min} goals` : `${min} to ${max} goals`;
  const lines = [
    'You design one speaking-practice mission for a Korean adult learning to speak English.',
    `Role-play setting: ${scenario.setupEn}`,
    `Use difficulty ${difficulty} of 5: ${DIFFICULTY_DESC[difficulty] ?? ''}`,
    `Give ${count}, written in Korean. Each goal must take several exchanges to achieve, not a single sentence: the learner has to answer the partner's follow-up questions, find something out, or solve a problem (e.g. "라테를 주문하고 직원이 묻는 사이즈와 우유 종류에 답하기", "영수증 금액이 다른 이유 알아내기").`,
    'situationEn is for the role-play partner: describe this variation, the follow-up questions the partner will ask, and hidden details the partner reveals only when the learner asks (prices, times, options).',
    difficulty >= 3 ? 'Also include one obstacle the learner must handle (sold out, a mistake, a policy, a delay).' : 'Keep the situation friendly with no obstacles.',
    'openingLine is the partner\'s first line in English, matching the difficulty.',
    'Make it different from earlier missions.',
  ];
  if (recentTitles.length) lines.push(`Recent missions to avoid repeating: ${recentTitles.join(' / ')}`);
  return {
    systemInstruction: { parts: [{ text: lines.join('\n') }] },
    contents: [{ role: 'user', parts: [{ text: 'Create the mission.' }] }],
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: MISSION_SCHEMA },
  };
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export async function generateMission(
  scenario: Scenario,
  difficulty: number,
  recentTitles: string[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Mission> {
  const raw = (await callGemini(buildMissionBody(scenario, difficulty, recentTitles), apiKey, fetchImpl, signal)) as Record<string, unknown>;
  const goals = Array.isArray(raw?.goals) ? raw.goals.filter(nonEmpty) : [];
  if (!nonEmpty(raw?.titleKo) || !nonEmpty(raw?.situationEn) || !nonEmpty(raw?.openingLine)) {
    throw new BadResponseError('mission is missing fields');
  }
  if (goals.length < 1 || goals.length > 4) throw new BadResponseError(`mission has ${goals.length} goals`);
  return {
    titleKo: raw.titleKo,
    goals,
    situationEn: raw.situationEn,
    openingLine: raw.openingLine,
    difficulty,
    source: 'ai',
  };
}
