import type { ScenarioProgress } from '../store/db';

export interface Outcome {
  achieved: boolean; // all goals done
  userTurns: number; // real answers (non-empty, not commands)
  corrections: number;
}

export type LevelChange = 'up' | 'down' | null;

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 5;

/** Difficulty rules from the spec (5.5). */
export function evaluate(
  p: ScenarioProgress,
  o: Outcome,
): { progress: ScenarioProgress; change: LevelChange; counted: boolean } {
  if (o.achieved) {
    const few = o.corrections * 3 <= o.userTurns;
    const level = few ? Math.min(MAX_LEVEL, p.level + 1) : p.level;
    return {
      progress: { ...p, level, failStreak: 0 },
      change: level > p.level ? 'up' : null,
      counted: true,
    };
  }
  if (o.userTurns < 2) return { progress: p, change: null, counted: false };
  const streak = p.failStreak + 1;
  if (streak >= 2) {
    const level = Math.max(MIN_LEVEL, p.level - 1);
    return { progress: { ...p, level, failStreak: 0 }, change: level < p.level ? 'down' : null, counted: true };
  }
  return { progress: { ...p, failStreak: streak }, change: null, counted: true };
}
