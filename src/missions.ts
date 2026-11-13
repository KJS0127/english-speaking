export interface Mission {
  titleKo: string;
  goals: string[]; // Korean, shown to the learner
  situationEn: string; // twist / setting for the AI
  openingLine: string; // AI's first line (English)
  difficulty: number; // 1-5
  source: 'ai' | 'fallback';
}

/** How many goals a mission has at each difficulty (spec 5.2). */
export function goalCountRange(difficulty: number): [number, number] {
  const table: Record<number, [number, number]> = { 1: [1, 2], 2: [2, 2], 3: [2, 3], 4: [3, 3], 5: [3, 4] };
  return table[Math.min(5, Math.max(1, Math.round(difficulty)))];
}

/** How the AI should talk at each difficulty (spec 5.3). */
export const DIFFICULTY_DESC: Record<number, string> = {
  1: 'Very short, simple sentences and basic words. No surprises.',
  2: 'Simple sentences, one question at a time.',
  3: 'Normal-length sentences. Add one unexpected question or a small problem (sold out, a mix-up).',
  4: 'Natural sentences with some common idioms. The learner must solve a problem or explain a choice.',
  5: 'Near-native speed and expressions, indirect wording. Include negotiation, a complaint, or giving reasons.',
};
