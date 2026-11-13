# 목표 있는 대화 + 난이도 자동 조절 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대화마다 AI가 만든(실패 시 예비) 목표를 주고 진행을 체크하며, 상황별 난이도 1~5를 결과에 따라 자동 조절한다.

**Architecture:** 순수 로직(난이도 평가, 예비 미션 선택)은 `src/session/difficulty.ts`, `src/missions.ts`. 미션 생성은 `src/ai/mission.ts`가 `src/ai/gemini.ts`의 공통 호출(`callGemini`, 모델 폴백 포함)을 재사용. 미션 시작/종료(진행 정보 읽기·쓰기, 최근 제목 기록)는 `src/session/missionRunner.ts`가 맡고 집 모드·차 모드가 공유. 차 모드 루프는 미션 단위로 세션을 새로 만든다.

**Tech Stack:** 기존과 동일 (Vite 5, TS strict, Vitest + jsdom + fake-indexeddb, idb).

**Spec:** `docs/superpowers/specs/2026-11-13-missions-and-difficulty-design.md`

## Global Constraints

- 한 사용자 턴당 API 호출 1번 + 미션당 생성 호출 1번까지.
- 차 모드: 미션 생성 실패 시 예비 미션으로 즉시 시작, 실패 사실을 말하지 않는다. 시작 후 화면·버튼 조작 불필요.
- 난이도 범위 1~5, 처음 1. 평가 규칙은 스펙 5.5 그대로 (오류 종료·일시정지는 평가 안 함, 명령/빈 턴은 사용자 턴 아님, 미달성은 사용자 턴 2개 이상일 때만, 달성은 항상).
- 올림 조건: 모두 달성 && corrections ≤ userTurns/3.
- 미션 하나 = 세션 하나.
- 백업: 진행 정보 포함(version 2), version 1 파일도 가져오기 가능.
- 화면 문구 한국어, AI 대화 영어. 집 모드 연습 방식 버튼 묶음 라벨은 "연습 방식".

## Review Focus

1. 미션 생성 응답이 깨졌거나 목표 0개/5개 이상 → 예비 미션으로 시작. (Task 2 `generateMission rejects bad goal counts`, Task 3 `startMission falls back`)
2. AI가 존재하지 않는 목표 번호나 이미 달성한 번호를 보냄 → 무시/중복 없음. (Task 2 `parseTurnResult filters goalsDone`, Task 4 `duplicate goal numbers count once`)
3. 사용 한도 오류로 미션 생성 실패 → 예비 미션으로 시작(턴에서 다시 한도면 기존대로 종료, 평가 안 함). (Task 4 `quota during turn does not evaluate`)
4. 예전 백업(version 1) 가져오기 → 진행 정보 비우고 성공. (Task 1 `imports version 1 backup`)
5. 같은 상황 최근 제목 5개 초과 → 오래된 것부터 버림. (Task 3 `recent titles keep last 5`)

---

### Task 1: 저장소 — 진행 정보, 세션 미션 필드, 백업 v2

**Files:** Modify `src/store/db.ts`; Test `tests/store/db.test.ts`

**Interfaces — Produces:**
```ts
export interface ScenarioProgress { scenarioId: string; level: number; failStreak: number; recentMissions: string[] }
// SessionRec gains optional: missionTitle?: string; goals?: string[]; difficulty?: number; achieved?: boolean
Db.getProgress(scenarioId): Promise<ScenarioProgress>   // default {level:1, failStreak:0, recentMissions:[]}
Db.saveProgress(p: ScenarioProgress): Promise<void>
Db.listProgress(): Promise<ScenarioProgress[]>
Db.updateSession(id: string, patch: Partial<SessionRec>): Promise<void>
```
DB version 2 adds store `progress` (keyPath `scenarioId`). exportBackup → `version: 2` with `progress`. importBackup accepts 1 (progress = []) or 2.

- [ ] Tests: `getProgress default`, `saveProgress round-trip`, `updateSession patches fields`, `export includes progress (version 2)`, `imports version 1 backup`, `rejects bad progress record`.
- [ ] RED → implement → GREEN → commit `feat: scenario progress store and mission fields`

### Task 2: Gemini — 공통 호출, 미션 생성, 턴 응답 확장

**Files:** Modify `src/ai/gemini.ts`, `src/ai/schema.ts`, `src/ai/prompt.ts`; Create `src/ai/mission.ts`; Tests `tests/ai/*.test.ts`, `tests/ai/mission.test.ts`

**Interfaces — Produces:**
```ts
// missions.ts (shared type, created here)
export interface Mission { titleKo: string; goals: string[]; situationEn: string; openingLine: string; difficulty: number; source: 'ai' | 'fallback' }
// gemini.ts
export function callGemini(body: object, apiKey: string, fetchImpl?: typeof fetch, signal?: AbortSignal): Promise<unknown> // parsed JSON from candidate text; same error mapping + model fallback
// schema.ts
Command adds 'goal' | 'otherScenario'
TurnResult adds goalsDone: number[]   // 1-based goal numbers newly achieved this turn; parse filters non-integers
// prompt.ts
TurnRequest adds mission: Mission; achieved: number[]   // already achieved (1-based)
// level (practice method 1|2|3) stays; difficulty comes from mission.difficulty
// ai/mission.ts
export function generateMission(scenario: Scenario, difficulty: number, recentTitles: string[], apiKey: string, fetchImpl?: typeof fetch, signal?: AbortSignal): Promise<Mission>
// throws BadResponseError when goals.length outside goalCountRange(difficulty) widened to [1,4] or fields missing
```
System prompt adds: difficulty description row (spec 5.3), mission situation, numbered goals with ✓ for achieved, rules (steer to goals, never say the learner's line for them, when last goal achieved wrap up in aiLine, suggestedReply targets a remaining goal), commands `goal` ("목표", "goal", "what's my goal") and `otherScenario` ("다른 상황", "different situation").

- [ ] Tests: `parseTurnResult filters goalsDone`, `parses goal/otherScenario commands`, `system prompt lists goals and marks achieved`, `system prompt includes difficulty description`, `generateMission builds request with recent titles and returns mission`, `generateMission rejects bad goal counts`, `callGemini falls back to next model` (move existing fallback test).
- [ ] RED → implement → GREEN → commit `feat: mission generation and goal tracking in turns`

### Task 3: 미션·예비 미션·난이도 규칙·미션 러너

**Files:** Create `src/missions.ts` (Mission type from Task 2 lives here, plus fallbacks), `src/session/difficulty.ts`, `src/session/missionRunner.ts`; Tests `tests/missions.test.ts`, `tests/session/difficulty.test.ts`, `tests/session/missionRunner.test.ts`

**Interfaces — Produces:**
```ts
// missions.ts
export function goalCountRange(difficulty: number): [number, number] // 1:[1,2] 2:[2,2] 3:[2,3] 4:[3,3] 5:[3,4]
export const FALLBACK_MISSIONS: Record<string, { titleKo: string; goals: string[]; situationEn: string }[]> // every scenario id, 1-2 each
export function fallbackMission(scenario: Scenario, difficulty: number, recentTitles: string[]): Mission // prefers one not in recentTitles; openingLine = scenario.openingLine
// difficulty.ts
export interface Outcome { achieved: boolean; userTurns: number; corrections: number }
export type LevelChange = 'up' | 'down' | null
export function evaluate(p: ScenarioProgress, o: Outcome): { progress: ScenarioProgress; change: LevelChange; counted: boolean }
// missionRunner.ts
export interface RunnerDeps { db: Pick<Db,'getProgress'|'saveProgress'>; generate: (s: Scenario, d: number, recent: string[], signal?: AbortSignal) => Promise<Mission> }
export function startMission(deps: RunnerDeps, scenario: Scenario, signal?: AbortSignal): Promise<Mission> // records title in recent (max 5)
export function finishMission(deps: RunnerDeps, scenarioId: string, o: Outcome): Promise<LevelChange>
```
- [ ] Tests: `every scenario has 1-2 fallback missions with 1-2 goals`, `fallback prefers unused title`, evaluate cases (up / stay with many corrections / fail streak 1 / second fail goes down / min 1 max 5 / fail with <2 turns not counted / success with 1 turn counted), `startMission uses AI mission`, `startMission falls back on any error`, `recent titles keep last 5`, `finishMission saves and returns change`.
- [ ] RED → implement → GREEN → commit `feat: fallback missions, difficulty rules, mission runner`

### Task 4: 차 모드 루프 — 미션 단위 진행

**Files:** Modify `src/session/carLoop.ts`, `src/session/phrases.ts`; Test `tests/session/carLoop.test.ts`

**Interfaces:**
- LoopDeps adds `startMission(scenario, signal): Promise<Mission>`, `finishMission(scenarioId, o: Outcome): Promise<LevelChange>`, `db` adds `startSession`, `updateSession`. `newId` stays.
- LoopCtx drops `sessionId` (kept optional for compat? no — removed); LoopState adds `sessionId: string | null; mission: Mission | null; achieved: number[]; userTurns: number; corrections: number`.
- Flow: if no mission → startMission → new session (startSession with mission fields) → speak KO.goalIntro + goals (ko) → opening (en). Turn: goalsDone new (not already, within range) → add; if some new and not all → KO.goalOne; if all → speak aiLine, KO.goalAll, updateSession achieved, finishMission(achieved) → speak level change → endSession → next mission same scenario. Commands: `goal` → speak remaining goals (ko); `next` → close mission (not achieved, evaluated) → new mission same scenario; `otherScenario` → close → nextScenario → new mission; `stop` → close (evaluated) → end. Errors quota/auth/fatal/tooManyBad → endSession without finishMission. Exported `closeMissionForQuit(deps, st)` used by car screen quit (evaluates, ends session).
- Phrases: `goalIntro: '이번 목표예요.'`, `goalOne: '목표 하나 달성!'`, `goalAll: '목표 달성!'`, `goalsLeft: '남은 목표예요.'`, `levelUp: (n)=>\`${n}단계로 올라갔어요!\``, `levelDown: (n)=>\`${n}단계로 낮췄어요. 천천히 다시 해 봐요.\``, `newMission: '새 목표로 넘어갈게요.'`, `otherScenario: '다른 상황으로 넘어갈게요.'`.
- [ ] Tests (update existing to fake startMission/finishMission): `speaks goals in Korean then opening`, `goal progress announces one`, `all goals: congratulate, evaluate achieved, start new session with new mission`, `duplicate goal numbers count once`, `goal command reads remaining goals`, `next abandons mission (evaluated not achieved) and starts new mission same scenario`, `otherScenario moves to next scenario`, `stop evaluates`, `quota during turn does not evaluate`, `command turns are not user turns`, `resume keeps mission and progress`.
- [ ] RED → implement → GREEN → commit `feat: mission-driven car loop`

### Task 5: 화면 — 홈 카드 단계, 집 모드 목표 카드, 차 모드 연결, 복습

**Files:** Modify `src/ui/home.ts`, `src/ui/homeMode.ts`, `src/ui/carMode.ts`, `src/ui/review.ts`, `src/main.ts`, `src/style.css`; Tests `tests/ui/*.test.ts`

- home: each card shows `N단계` from `db.getProgress`.
- homeMode deps add `startMission`, `finishMission`; shows "이번 목표를 준비하고 있어요…" (mic disabled) → goal card (title, `N단계`, ☐/☑ list); levels bar label "연습 방식"; session starts lazily with mission fields; all goals → success summary with level change text and "다음 목표" button (re-render same scenario); `next` command → evaluate + new mission; `otherScenario` → evaluate + navigate next scenario; leave/끝내기 → evaluate (not achieved) once.
- carMode: pass runner deps; quit button → `closeMissionForQuit`.
- review: list rows show mission title (fallback scenario title) and ✓ when achieved; detail shows goals and `N단계`.
- [ ] Tests: `home card shows level`, `home mode shows preparing then goal card`, `goal checkbox updates on goalsDone`, `all goals shows success with level up text and next-mission button`, `leaving evaluates once`, `levels bar labelled 연습 방식`, `car quit evaluates mission`, `review shows mission title and achieved mark`.
- [ ] RED → implement → GREEN; build; browser smoke; commit `feat: goal cards, level badges, mission review`

### Task 6: 최종 검토와 배포
- [ ] Fresh reviewer on whole diff; fix Critical/Important with RED→GREEN; bump SW cache; push; verify deployed bundle.
