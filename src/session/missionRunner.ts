import { fallbackMission, type Mission } from '../missions';
import type { Scenario } from '../scenarios';
import type { Db } from '../store/db';
import { evaluate, type LevelChange, type Outcome } from './difficulty';

export interface RunnerDeps {
  db: Pick<Db, 'getProgress' | 'saveProgress'>;
  generate: (scenario: Scenario, difficulty: number, recentTitles: string[], signal?: AbortSignal) => Promise<Mission>;
}

const MAX_RECENT = 5;

/** Gets a mission at the scenario's current level: AI first, fallback on any failure. */
export async function startMission(deps: RunnerDeps, scenario: Scenario, signal?: AbortSignal): Promise<Mission> {
  const p = await deps.db.getProgress(scenario.id);
  let mission: Mission;
  try {
    mission = await deps.generate(scenario, p.level, p.recentMissions, signal);
  } catch {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    mission = fallbackMission(scenario, p.level, p.recentMissions);
  }
  await deps.db.saveProgress({ ...p, recentMissions: [...p.recentMissions, mission.titleKo].slice(-MAX_RECENT) });
  return mission;
}

/** Applies the difficulty rules for a finished mission and saves the result. */
export async function finishMission(deps: RunnerDeps, scenarioId: string, o: Outcome): Promise<LevelChange> {
  const p = await deps.db.getProgress(scenarioId);
  const r = evaluate(p, o);
  if (r.counted) await deps.db.saveProgress(r.progress);
  return r.change;
}
