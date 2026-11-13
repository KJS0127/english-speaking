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
    `Give ${count}. Each goal is one concrete thing the learner must say or get done, written in Korean (e.g. "큰 사이즈 아이스 라테 주문하기").`,
    'situationEn describes this specific variation (a detail or small twist that fits the difficulty) for the role-play partner.',
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
