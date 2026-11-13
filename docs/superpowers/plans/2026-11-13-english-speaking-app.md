# 영어 말하기 연습 앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 아이폰 홈 화면에서 실행되는 0원 영어 말하기 연습 PWA. 집 모드(단계적 도움)와 차 모드(화면·손 없이 소리로만)를 제공하고 대화 기록을 복습할 수 있게 한다.

**Architecture:** 정적 웹앱(Vite + TypeScript, 프레임워크 없음). 마이크 입력을 Web Audio로 받아 소리 크기로 말 끝을 감지하고, 16kHz WAV로 만들어 Gemini REST API(`generateContent`, JSON 응답 스키마)에 한 턴당 한 번 보낸다. 대답은 `speechSynthesis`로 읽고, 기록은 IndexedDB에 저장한다. 차 모드 대화 루프는 의존성을 주입받는 순수 로직(`runCarLoop`)으로 만들어 가짜 객체로 테스트한다.

**Tech Stack:** Vite 5, TypeScript 5 (strict), Vitest + jsdom + fake-indexeddb, `idb` (IndexedDB 래퍼), Gemini API v1beta REST(fetch 직접 호출, SDK 없음), GitHub Pages(GitHub Actions 배포).

**Spec:** `docs/superpowers/specs/2026-11-13-english-speaking-app-design.md`

## Global Constraints

- 운영 비용 0원: 유료 API, 유료 호스팅, 유료 라이브러리 금지.
- 대상: 아이폰 사파리, 홈 화면에 추가한 PWA. HTTPS 필수.
- Gemini API 키는 코드·저장소에 넣지 않는다. 첫 실행 때 입력받아 IndexedDB `settings`에만 저장한다.
- Gemini 호출은 **사용자 한 턴당 한 번**만 한다. 음성 명령("다시", "천천히", "한국어로", "힌트")은 추가 호출 없이 직전 응답의 필드로 처리한다.
- 차 모드: 시작 버튼을 누른 뒤에는 화면·물리 버튼 조작이 전혀 필요 없어야 한다. AI가 말하는 도중에는 듣지 않는다(끼어들기 없음).
- 사용자 목소리 녹음은 저장하지 않는다. 글(받아 적은 내용, AI 대사, 교정, 발음 피드백)만 저장한다.
- 집 모드 교정은 대화 중에 끊지 않고 대화가 끝난 뒤 모아서 보여준다(대화 중에는 턴 옆에 작은 표시만).
- 앱 화면 문구는 한국어. AI 대화는 영어.
- 앱 안에 "Gemini 무료 등급은 입력 내용이 구글 서비스 개선에 쓰일 수 있어요. 개인정보는 말하지 마세요." 안내를 설정 화면에 표시한다.
- 스픽(Speak)의 이름·로고·캐릭터·디자인을 쓰지 않는다. 앱 이름은 `영어 말하기`.
- 차 모드에서는 교정 내용을 소리로 말하지 않고 기록에만 남긴다 (설계 문서가 작성자에게 맡긴 부분을 이렇게 정함: 운전 중 말 수를 줄이기 위해).

## Review Focus

1. **잡음만 있거나 아무 말도 안 한 녹음** (차 소음, 기침): 0.3초 미만 소리는 말로 치지 않고, 받아 적은 내용이 비어 있으면 기록하지 않고 조용히 다시 듣는다. → Task 1 `ignores short noise bursts`, Task 5 `empty transcript is ignored`.
2. **Gemini가 깨진 JSON이나 필드가 빠진 응답을 줌**: 앱이 멈추지 않고 "Sorry, could you say that again?"을 말한 뒤 계속한다. → Task 2 `parseTurnResult rejects missing aiLine`, Task 5 `bad response asks to repeat`.
3. **API 키가 틀리거나 만료됨 (401/403)**: 무한 재시도하지 않고 소리로 알린 뒤 끝낸다. 집 모드에서는 설정 화면으로 안내한다. → Task 2 `maps 403 to AuthError`, Task 5 `auth error ends loop`.
4. **운전 중 인터넷 끊김**: 한 번만 소리로 알리고, 같은 녹음으로 재시도하다가 연결되면 "다시 연결됐어요" 후 이어간다. → Task 5 `network error retries and resumes`.
5. **깨진 백업 파일 가져오기**: 기존 데이터를 지우지 않고 오류만 표시한다. → Task 4 `importBackup with invalid file keeps existing data`.

---

## File Structure

```
index.html                    앱 진입점
spike.html                    아이폰 시험판 (Task 3)
public/manifest.webmanifest   PWA 매니페스트
public/sw.js                  서비스 워커 (앱 셸 캐시)
public/icon-192.png, icon-512.png, apple-touch-icon.png
src/config.ts                 상수 (기준값, 모델 이름)
src/audio/wav.ts              rms, downsample, encodeWav (순수)
src/audio/vad.ts              말 시작/끝 감지 (순수)
src/audio/mic.ts              getUserMedia + Web Audio → 한 발화 Float32Array
src/audio/speaker.ts          speechSynthesis 래퍼
src/ai/errors.ts              AuthError, QuotaError, NetworkError, BadResponseError
src/ai/schema.ts              TurnResult 타입, responseSchema, parseTurnResult
src/ai/prompt.ts              buildSystemPrompt, buildBody
src/ai/gemini.ts              sendTurn
src/scenarios.ts              상황 목록
src/store/db.ts               IndexedDB 저장소 + 백업
src/session/carLoop.ts        차 모드 대화 루프 (의존성 주입)
src/session/phrases.ts        차 모드 한국어 안내 문구
src/ui/router.ts              화면 전환
src/ui/settings.ts            API 키, 음성 속도, 안내
src/ui/home.ts                상황 선택 + 모드 선택
src/ui/homeMode.ts            집 모드 대화 화면
src/ui/carMode.ts             차 모드 화면 (큰 시작 버튼, Wake Lock)
src/ui/review.ts              복습 화면
src/main.ts                   부트스트랩, 서비스 워커 등록
src/style.css
tests/...                     src 구조와 같은 경로에 *.test.ts
.github/workflows/deploy.yml  GitHub Pages 배포
```

---

### Task 1: 프로젝트 뼈대 + 오디오 순수 로직 (WAV, 말 끝 감지)

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `.gitignore`, `index.html`, `src/main.ts`, `src/config.ts`, `src/audio/wav.ts`, `src/audio/vad.ts`
- Test: `tests/audio/wav.test.ts`, `tests/audio/vad.test.ts`

**Interfaces:**
- Produces:
  - `CONFIG` in `src/config.ts`:
    ```ts
    export const CONFIG = {
      sampleRate: 16000,
      vad: { rmsThreshold: 0.02, silenceMs: 1200, minSpeechMs: 300, maxUtteranceMs: 30000 },
      idlePromptMs: 45000,
      model: 'gemini-2.5-flash', // 구현 시 공식 문서에서 무료 등급 + 오디오 입력 가능한 최신 Flash 모델로 확인 후 교체
      ttsRate: { normal: 0.95, slow: 0.7 },
      retryDelaysMs: [2000, 5000, 10000], // 마지막 값으로 계속 반복
    } as const;
    ```
  - `rms(frame: Float32Array): number`
  - `downsample(samples: Float32Array, fromRate: number, toRate: number): Float32Array`
  - `encodeWav(samples: Float32Array, sampleRate: number): Uint8Array` (16-bit PCM mono, 44바이트 헤더)
  - `type VadEvent = 'speech-start' | 'speech-end' | null`
  - `createSilenceDetector(opts: { rmsThreshold: number; silenceMs: number; minSpeechMs: number; maxUtteranceMs: number }): { push(level: number, frameMs: number): VadEvent; reset(): void }`

- [ ] **Step 1: 뼈대 만들기**

이 프로젝트 폴더에서 `git init`. `npm create vite@5` 대신 직접 파일을 만든다: dependencies `idb`; devDependencies `vite@5`, `typescript@5`, `vitest`, `jsdom`, `fake-indexeddb`. `vite.config.ts`에 `base: './'`, 입력 두 개(`index.html`, `spike.html` — spike는 Task 3에서 추가). `tsconfig` strict. `.gitignore`에 `node_modules`, `dist`. scripts: `dev`, `build`, `test` (`vitest run`).

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// tests/audio/wav.test.ts
test('rms of constant 0.5 is 0.5', () => expect(rms(new Float32Array(100).fill(0.5))).toBeCloseTo(0.5));
test('downsample 48000→16000 keeps 1/3 length', () => expect(downsample(new Float32Array(4800), 48000, 16000).length).toBe(1600));
test('encodeWav writes RIFF header, rate, and 16-bit samples', () => {
  const out = encodeWav(new Float32Array([0, 1, -1]), 16000);
  const v = new DataView(out.buffer);
  expect(new TextDecoder().decode(out.slice(0, 4))).toBe('RIFF');
  expect(new TextDecoder().decode(out.slice(8, 12))).toBe('WAVE');
  expect(v.getUint32(24, true)).toBe(16000);
  expect(v.getUint16(34, true)).toBe(16);
  expect(out.length).toBe(44 + 3 * 2);
  expect(v.getInt16(46, true)).toBe(32767);
  expect(v.getInt16(48, true)).toBe(-32768);
});
// tests/audio/vad.test.ts  (opts: threshold 0.02, silence 1200, minSpeech 300, max 30000; frame 100ms)
test('emits speech-start then speech-end after 1200ms silence', ...);
  // 5 frames at 0.1 → first returns 'speech-start'; then 12 frames at 0 → 12th returns 'speech-end'
test('ignores short noise bursts', ...);
  // 2 frames at 0.1 (200ms < 300) then 12 frames at 0 → no 'speech-end' emitted, all null after start
test('forces speech-end at maxUtteranceMs', ...);
  // 300 frames of 0.1 → frame 300 returns 'speech-end'
test('reset clears state', ...);
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/audio` → FAIL (모듈 없음)

- [ ] **Step 4: `src/config.ts`, `src/audio/wav.ts`, `src/audio/vad.ts` 구현**

`downsample`은 구간 평균. `encodeWav`는 샘플을 [-1,1]로 자른 뒤 양수×32767, 음수×32768. 짧은 소리(minSpeechMs 미만) 뒤의 침묵은 'speech-end' 없이 상태를 초기화하고 null을 반환한다.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/audio` → PASS

- [ ] **Step 6: Commit** — `feat: project scaffold, wav encoder, silence detector`

---

### Task 2: Gemini 클라이언트 (스키마, 프롬프트, 오류 처리)

**Files:**
- Create: `src/ai/errors.ts`, `src/ai/schema.ts`, `src/ai/prompt.ts`, `src/ai/gemini.ts`, `src/scenarios.ts`
- Test: `tests/ai/schema.test.ts`, `tests/ai/prompt.test.ts`, `tests/ai/gemini.test.ts`

**Interfaces:**
- Consumes: `CONFIG.model`
- Produces:
  ```ts
  // errors.ts
  export class AuthError extends Error {}; export class QuotaError extends Error {};
  export class NetworkError extends Error {}; export class BadResponseError extends Error {};
  // schema.ts
  export type Command = 'none'|'repeat'|'slower'|'korean'|'hint'|'next'|'stop';
  export interface Correction { original: string; better: string; why: string } // why는 한국어
  export interface TurnResult {
    transcript: string; command: Command; aiLine: string; aiLineKo: string;
    suggestedReply: string; correction: Correction | null; pronunciation: string | null; // pronunciation은 한국어 설명
  }
  export const RESPONSE_SCHEMA: object; // Gemini responseSchema (OpenAPI subset), 위 필드 전부, correction/pronunciation nullable
  export function parseTurnResult(raw: unknown): TurnResult;
  // scenarios.ts
  export type Category = 'daily'|'travel'|'business'|'free';
  export interface Scenario { id: string; category: Category; titleKo: string; setupEn: string; openingLine: string }
  export const SCENARIOS: Scenario[];
  export function nextScenario(current: Scenario): Scenario; // 같은 카테고리의 다음 상황, 마지막이면 처음으로
  // prompt.ts
  export interface HistoryItem { role: 'user'|'ai'; text: string }
  export interface TurnRequest {
    scenario: Scenario; mode: 'home'|'car'; level: 1|2|3; history: HistoryItem[];
    weakPhrases: { original: string; better: string }[]; audioWav: Uint8Array; typedText?: string;
  }
  export function buildSystemPrompt(req: TurnRequest): string;
  export function buildBody(req: TurnRequest): object;
  // gemini.ts
  export function sendTurn(req: TurnRequest, apiKey: string, fetchImpl?: typeof fetch): Promise<TurnResult>;
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// schema.test.ts
test('parseTurnResult accepts full object', ...); // 모든 필드 그대로 반환
test('parseTurnResult fills defaults', ...);
  // {transcript:'hi', aiLine:'Hello'} → command 'none', aiLineKo '', suggestedReply '', correction null, pronunciation null
test('parseTurnResult rejects missing aiLine', () => expect(() => parseTurnResult({ transcript: 'hi' })).toThrow(BadResponseError));
test('parseTurnResult maps unknown command to none', ...);
// prompt.test.ts
test('system prompt includes scenario setup and level', ...); // contains scenario.setupEn, 'level 2'
test('car mode prompt asks for short AI lines', ...); // contains 'at most 2 short sentences'
test('weak phrases are listed for reuse', ...); // contains each `better`
test('command detection covers Korean and English words', ...);
  // contains '다시', 'repeat', '천천히', '한국어로', '힌트', '다음', '그만'
test('buildBody sends audio inline as wav and json schema', ...);
  // last content part: { inlineData: { mimeType: 'audio/wav', data: <base64> } }
  // generationConfig.responseMimeType === 'application/json', responseSchema === RESPONSE_SCHEMA
  // history items appear as text parts with roles 'user'/'model'
test('typedText is sent as the intended sentence', ...); // level 1: text part contains 'Intended sentence:' + typedText
// gemini.test.ts (fetchImpl 가짜)
test('posts to model endpoint with x-goog-api-key header', ...);
  // url ends with `/v1beta/models/${CONFIG.model}:generateContent`; headers['x-goog-api-key']==='KEY'
test('returns parsed result from candidates[0].content.parts[0].text', ...);
test('maps 400 API_KEY_INVALID and 401/403 to AuthError', ...);
test('maps 429 to QuotaError', ...);
test('maps fetch rejection to NetworkError', ...);
test('maps non-JSON text to BadResponseError', ...);
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/ai` → FAIL

- [ ] **Step 3: 구현**

`SCENARIOS`: 카테고리마다 4개 이상(일상: 카페 주문, 이웃과 스몰토크, 식당 예약 전화, 병원 접수 / 여행: 공항 체크인, 호텔 체크인, 길 묻기, 식당 주문 / 비즈니스: 자기소개, 회의에서 의견 말하기, 일정 조율 전화, **이메일 문장을 회의 말투로 바꿔 말하기** / 자유 대화 1개: AI가 "What would you like to talk about today?"로 시작). 시스템 프롬프트 요점: 상대역 역할 유지, 사용자는 글로는 영어를 쓰지만 말하기 초보, 쉬운 문장과 천천히, 교정은 `correction`에만(대사에 섞지 않음), 고칠 게 없으면 null, `aiLineKo`는 aiLine의 한국어 뜻, `suggestedReply`는 사용자가 다음에 할 만한 쉬운 대답, 명령어 감지 규칙, 차 모드는 AI 대사 2문장 이하, 약점 표현을 대화에 자연스럽게 다시 쓰기. base64는 `btoa` + 청크 처리.

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/ai` → PASS

- [ ] **Step 5: Commit** — `feat: gemini turn client with json schema and error mapping`

---

### Task 3: 마이크·스피커 + 아이폰 시험판 (확인 관문)

**Files:**
- Create: `src/audio/mic.ts`, `src/audio/speaker.ts`, `spike.html`, `src/spike.ts`, `public/manifest.webmanifest`, `public/apple-touch-icon.png`, `public/icon-192.png`, `public/icon-512.png`, `.github/workflows/deploy.yml`
- Test: `tests/audio/speaker.test.ts`

**Interfaces:**
- Consumes: `CONFIG`, `rms`, `downsample`, `encodeWav`, `createSilenceDetector`, `sendTurn`, `SCENARIOS`
- Produces:
  ```ts
  // mic.ts
  export interface ListenOpts { signal?: AbortSignal; idleMs?: number; onIdle?: () => void; onSpeechStart?: () => void }
  export interface Mic { listen(opts?: ListenOpts): Promise<Float32Array>; close(): void } // 16kHz 한 발화. abort 시 DOMException('AbortError')로 reject
  export function openMic(): Promise<Mic>; // 반드시 사용자 터치 핸들러 안에서 호출
  // speaker.ts
  export interface SpeakOpts { lang: 'en-US'|'ko-KR'; rate: number }
  export function unlockSpeech(): void;        // 터치 핸들러 안에서 빈 발화 1회
  export function speak(text: string, opts: SpeakOpts): Promise<void>; // onend/onerror에서 resolve
  export function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null;
  // 'Enhanced'/'Premium'/'향상된'/'고품질' 이름이 들어간 같은 언어 음성 우선, 없으면 같은 언어 아무거나, 없으면 null
  ```

- [ ] **Step 1: 실패하는 테스트** — `pickVoice` 3가지: 향상된 음성 우선 / 같은 언어 기본 / 없으면 null.
- [ ] **Step 2: 실패 확인** — `npx vitest run tests/audio/speaker.test.ts` → FAIL
- [ ] **Step 3: `mic.ts`, `speaker.ts` 구현**

`mic.ts`: `getUserMedia({audio:{echoCancellation:true, noiseSuppression:true}})` → `AudioContext` → `ScriptProcessorNode`(4096) 또는 AudioWorklet로 프레임 수집, 프레임마다 `rms` → 감지기 `push`. 'speech-start'부터 'speech-end'까지 샘플을 모아 `downsample(…, ctx.sampleRate, 16000)` 반환. 'speech-start' 직전 300ms를 미리 담아 둔다(첫 음절 잘림 방지). 말하기 대기 중 `idleMs` 동안 말이 없으면 `onIdle` 1회 호출.

- [ ] **Step 4: 통과 확인** — `npx vitest run` → PASS

- [ ] **Step 5: 시험판 `spike.html` 작성**

화면: API 키 입력칸(입력값은 localStorage에만), "시작" 버튼, 상태 로그. 시작 터치 → `unlockSpeech()`, `openMic()`, `navigator.wakeLock.request('screen')`(결과 로그) → 무한 루프: `listen` → `encodeWav` → `sendTurn`(자유 대화, car 모드) → 응답 시간(ms) 로그 → `speak(aiLine)` → 다시 `listen`. 연속 성공 턴 수, `display-mode: standalone` 여부, Wake Lock 상태, 오류를 화면에 표시.

- [ ] **Step 6: 배포 설정**

`deploy.yml`: main 푸시 시 `npm ci && npm run build` → `actions/deploy-pages`. **GitHub 저장소 생성과 푸시는 사용자에게 먼저 확인받고 진행한다.**

- [ ] **Step 7: Commit** — `feat: mic, speaker, iphone spike page`

- [ ] **Step 8: 🚦 사용자 아이폰 확인 (관문)**

사용자가 배포된 `spike.html`을 사파리에서 열고 → 공유 → 홈 화면에 추가 → 홈 화면에서 실행해 아래를 확인한다. 결과를 기록한다.

| # | 확인 | 통과 기준 |
|---|---|---|
| 1 | 홈 화면 앱에서 마이크 녹음 | 첫 턴 받아 적기 성공 |
| 2 | 화면 계속 켜짐 | 5분 동안 화면이 꺼지지 않음 |
| 3 | 손 안 대고 이어지기 | 10턴 연속, 터치 없이 성공 |
| 4 | 차 소음 속 말 끝 감지 | 주행 중 10턴 중 8턴 이상 정상 |
| 5 | Gemini 무료 + 응답 시간 | 오류 없이 응답, 평균 3초 이하 |

- 모두 통과 → Task 4로.
- **3번 실패** → 진행을 멈추고 사용자에게 보고한다. 설계에 따라 차 모드 대화 부분을 C안(Gemini Live API)으로 바꾸는 별도 계획을 세운다(물리 버튼 대안은 사용자가 거절함).
- 기준값 문제(4번, 5번 일부) → `CONFIG` 값 조정 후 재시험.
- 그 밖의 실패 → 멈추고 사용자와 설계를 다시 본다.

---

### Task 4: 저장소 (IndexedDB) + 백업

**Files:**
- Create: `src/store/db.ts`
- Test: `tests/store/db.test.ts` (`import 'fake-indexeddb/auto'`)

**Interfaces:**
- Consumes: `Correction` (schema.ts)
- Produces:
  ```ts
  export interface SessionRec { id: string; scenarioId: string; mode: 'home'|'car'; startedAt: number; endedAt: number | null }
  export interface TurnRec { id: string; sessionId: string; idx: number; at: number; transcript: string; aiLine: string;
    correction: Correction | null; pronunciation: string | null }
  export interface WeakPhrase { key: string /* better 소문자 trim */; original: string; better: string; count: number; lastSeen: number }
  export class BackupError extends Error {}
  export interface Db {
    startSession(s: Omit<SessionRec,'endedAt'>): Promise<void>;
    endSession(id: string, at: number): Promise<void>;
    addTurn(t: TurnRec): Promise<void>;          // correction이 있으면 WeakPhrase upsert(count+1)
    listSessions(): Promise<SessionRec[]>;        // 최신순
    getTurns(sessionId: string): Promise<TurnRec[]>; // idx순
    topWeakPhrases(n: number): Promise<WeakPhrase[]>; // count 내림차순, 같으면 lastSeen 최신순
    getSetting<T>(key: string): Promise<T | undefined>;
    setSetting(key: string, value: unknown): Promise<void>;
    exportBackup(): Promise<string>;              // {version:1, sessions, turns, weakPhrases} JSON. settings(API 키)는 제외
    importBackup(json: string): Promise<void>;
  }
  export function openDb(name?: string): Promise<Db>; // 기본 'speaking-practice'
  ```

- [ ] **Step 1: 실패하는 테스트**

```ts
test('addTurn with correction creates weak phrase and increments on repeat', ...); // 두 번 → count 2
test('topWeakPhrases orders by count desc', ...);
test('listSessions newest first; getTurns ordered by idx', ...);
test('exportBackup excludes settings', ...); // setSetting('apiKey','K') 후 export 문자열에 'K' 없음
test('export then import into fresh db restores sessions, turns, weakPhrases', ...);
test('importBackup with invalid file keeps existing data', ...);
  // '{"version":1,"sessions":"x"}' 와 'not json' → BackupError, 기존 세션 수 그대로
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/store` → FAIL
- [ ] **Step 3: 구현** — `importBackup`은 전체 구조를 먼저 검증한 뒤 하나의 트랜잭션에서 sessions/turns/weakPhrases를 비우고 채운다.
- [ ] **Step 4: 통과 확인** — `npx vitest run tests/store` → PASS
- [ ] **Step 5: Commit** — `feat: indexeddb store with weak phrases and backup`

---

### Task 5: 차 모드 대화 루프 (핵심 로직)

**Files:**
- Create: `src/session/carLoop.ts`, `src/session/phrases.ts`
- Test: `tests/session/carLoop.test.ts`

**Interfaces:**
- Consumes: `Mic.listen`, `speak`, `sendTurn`, `encodeWav`, `nextScenario`, `Db.addTurn/endSession`, 오류 클래스, `CONFIG`
- Produces:
  ```ts
  // phrases.ts — 한국어 안내 문구 (정확한 문구)
  export const KO = {
    idle: '계속할까요? 준비되면 말해 주세요.',
    hintIntro: '이렇게 말해 보세요.',
    next: '다음 상황으로 넘어갈게요.',
    stop: '연습을 마칠게요. 수고하셨어요.',
    offline: '인터넷 연결이 끊겼어요. 다시 연결되면 이어갈게요.',
    online: '다시 연결됐어요.',
    quota: '오늘 무료 사용량이 끝났어요. 연습을 마칠게요.',
    auth: 'API 키에 문제가 있어요. 집에서 설정을 확인해 주세요.',
  } as const;
  export const EN_RETRY = 'Sorry, could you say that again?';
  // carLoop.ts
  export interface LoopDeps {
    listen(opts: { signal: AbortSignal; idleMs: number; onIdle: () => void }): Promise<Float32Array>;
    send(req: TurnRequest): Promise<TurnResult>;
    speak(text: string, opts: SpeakOpts): Promise<void>;
    db: Pick<Db, 'addTurn' | 'endSession'>;
    now(): number; sleep(ms: number): Promise<void>; newId(): string;
  }
  export interface LoopCtx { sessionId: string; scenario: Scenario; weakPhrases: { original: string; better: string }[] }
  export type LoopEnd = 'stopped' | 'quota' | 'auth' | 'paused';
  export function runCarLoop(deps: LoopDeps, ctx: LoopCtx, signal: AbortSignal): Promise<LoopEnd>;
  ```

- [ ] **Step 1: 실패하는 테스트** (가짜 deps: listen은 큐에서 꺼내고, send는 미리 정한 결과/오류를 차례로 반환, speak 호출 기록)

```ts
test('speaks opening line first in en-US normal rate', ...);
test('normal turn: sends once, speaks aiLine, saves turn without audio', ...);
  // send 1회, addTurn 인자에 transcript/aiLine/correction, 오디오 필드 없음
test('car mode does not speak corrections', ...); // correction 있어도 speak 호출 텍스트에 correction.better 없음
test('repeat speaks last aiLine again and does not save turn', ...);
test('slower repeats last line at slow rate and keeps slow rate after', ...);
test('korean speaks last aiLineKo in ko-KR', ...);
test('hint speaks KO.hintIntro then suggestedReply', ...); // 직전 응답의 suggestedReply
test('next speaks KO.next then next scenario opening', ...);
test('stop speaks KO.stop, ends session, returns stopped', ...);
test('empty transcript is ignored', ...); // transcript '  ' → speak 없음, addTurn 없음, 다시 listen
test('idle prompt is spoken once per silent stretch', ...); // onIdle 두 번 호출돼도 KO.idle은 다음 발화 전까지 1번
test('bad response asks to repeat', ...); // BadResponseError → speak(EN_RETRY, en-US) 후 계속
test('network error retries and resumes', ...);
  // NetworkError, NetworkError, 성공 → KO.offline 1번, sleep(2000), sleep(5000), KO.online 1번, 같은 오디오로 재전송, aiLine 말함
test('quota error ends loop', ...); // KO.quota, endSession, 'quota'
test('auth error ends loop', ...); // KO.auth, endSession, 'auth'
test('abort returns paused without ending session', ...); // signal.abort() → 'paused', endSession 호출 없음
test('history passed to send contains prior transcripts and aiLines', ...);
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/session` → FAIL
- [ ] **Step 3: `runCarLoop` 구현** — 요청은 항상 `mode: 'car'`, `level: 3`. 순서: 오프닝 말하기 → 반복 { listen(idleMs=CONFIG.idlePromptMs) → `encodeWav` → send(재시도 포함) → command 처리 또는 일반 턴 }. 명령 처리는 직전 일반 턴의 결과를 쓴다. 'next'는 history를 비운다. 재시도 간격은 `CONFIG.retryDelaysMs`, 마지막 값으로 계속 반복하며 abort 시 'paused'.
- [ ] **Step 4: 통과 확인** — `npx vitest run tests/session` → PASS
- [ ] **Step 5: Commit** — `feat: hands-free car conversation loop`

---

### Task 6: 앱 셸 — 상황 선택, 설정, PWA

**Files:**
- Create: `src/ui/router.ts`, `src/ui/home.ts`, `src/ui/settings.ts`, `src/style.css`, `public/sw.js`
- Modify: `index.html`, `src/main.ts`, `public/manifest.webmanifest`
- Test: `tests/ui/settings.test.ts` (jsdom)

**Interfaces:**
- Consumes: `openDb`, `SCENARIOS`, `CONFIG`
- Produces:
  - `type Route = { name: 'home' } | { name: 'settings' } | { name: 'homeMode'; scenarioId: string } | { name: 'carMode'; scenarioId: string } | { name: 'review'; sessionId?: string }`
  - `navigate(route: Route): void`, `onRoute(render: (r: Route) => void): void` (hash 기반: `#/home`, `#/car/<id>` 등)
  - 설정 키: `'apiKey'` (string), `'ttsRate'` (number, 기본 `CONFIG.ttsRate.normal`)
  - `renderSettings(root: HTMLElement, db: Db): void`, `renderHome(root: HTMLElement, db: Db): void`

- [ ] **Step 1: 실패하는 테스트**

```ts
test('settings saves trimmed api key', ...); // 입력 '  KEY  ' → 저장 → getSetting('apiKey') === 'KEY'
test('settings shows free-tier privacy notice', ...); // Global Constraints 문구 그대로 포함
test('settings shows enhanced voice download guide', ...); // '설정 → 손쉬운 사용 → 읽기 및 말하기 → 음성' 포함
test('home redirects to settings when api key missing', ...);
test('home lists categories 일상/여행/비즈니스/자유 대화 with scenarios and two mode buttons', ...);
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/ui` → FAIL
- [ ] **Step 3: 구현** — 홈 화면: 카테고리별 상황 카드, 카드마다 "집에서 연습" / "차에서 연습" 버튼, 상단에 "복습" 링크. 설정 화면: API 키 입력(가려진 입력칸), 음성 속도 슬라이더, 안내 문구 2개, 백업 내보내기/가져오기 버튼(내보내기는 `speaking-backup-YYYYMMDD.json` 파일 다운로드, 가져오기 실패 시 "백업 파일을 읽을 수 없어요. 기존 기록은 그대로예요." 표시). `sw.js`는 앱 셸(빌드 결과물) 캐시만, Gemini 요청은 캐시하지 않는다. 매니페스트 `display: standalone`, `name: 영어 말하기`.
- [ ] **Step 4: 통과 확인** — `npx vitest run` → PASS
- [ ] **Step 5: Commit** — `feat: app shell, scenario picker, settings, pwa manifest`

---

### Task 7: 집 모드 대화 화면

**Files:**
- Create: `src/ui/homeMode.ts`
- Test: `tests/ui/homeMode.test.ts` (jsdom, mic/send/speak 가짜 주입)

**Interfaces:**
- Consumes: `openMic`, `speak`, `unlockSpeech`, `sendTurn`, `encodeWav`, `Db`, `Scenario`, `TurnResult`
- Produces: `renderHomeMode(root: HTMLElement, deps: { db: Db; mic: () => Promise<Mic>; send: typeof sendTurn; speak: typeof speak }, scenario: Scenario): void`

- [ ] **Step 1: 실패하는 테스트**

```ts
test('level selector offers 쓰고 말하기 / 힌트 보고 말하기 / 바로 말하기', ...);
test('level 1 requires typed text before mic button enables and sends typedText', ...);
test('level 2 hint button reveals aiLineKo and suggestedReply of last AI turn', ...);
test('level 3 shows no hint button', ...);
test('during conversation corrections show only a small marker', ...); // correction 있는 턴에 '•' 표시, better 문구는 숨김
test('ending conversation shows all corrections and pronunciation notes', ...);
test('AuthError shows message with link to settings', ...);
test('QuotaError shows 오늘 무료 사용량이 끝났어요 and disables mic', ...);
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/ui/homeMode.test.ts` → FAIL
- [ ] **Step 3: 구현** — 첫 터치에서 `unlockSpeech()`. 마이크 버튼 터치 → `listen`(자동 끝 감지) → 전송 → 대사 표시 + 읽기. AI 대사 옆 "다시 듣기" 버튼. "대화 끝내기" → `endSession` → 교정 요약 화면.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat: home practice mode with scaffolding levels`

---

### Task 8: 차 모드 화면

**Files:**
- Create: `src/ui/carMode.ts`
- Test: `tests/ui/carMode.test.ts`

**Interfaces:**
- Consumes: `runCarLoop`, `LoopDeps`, `openMic`, `speak`, `unlockSpeech`, `sendTurn`, `Db.topWeakPhrases/startSession`
- Produces: `renderCarMode(root: HTMLElement, deps: { db: Db; mic: () => Promise<Mic>; send: typeof sendTurn; speak: typeof speak; wakeLock?: WakeLockLike }, scenario: Scenario): void`
  - `interface WakeLockLike { request(type: 'screen'): Promise<{ release(): Promise<void> }> }`

- [ ] **Step 1: 실패하는 테스트**

```ts
test('shows one large start button and the safety notice', ...);
  // 문구: '출발 전에 시작을 눌러 주세요. 운전 중에는 화면을 보지 마세요.'
test('start requests wake lock, opens mic, unlocks speech, starts session with weak phrases', ...);
test('warns before start when wake lock is unavailable', ...);
  // '이 기기에서는 화면 켜짐 유지가 안 돼요. 화면 자동 잠금을 꺼 주세요.'
test('visibility hidden aborts loop (paused) and shows 이어하기 button', ...);
test('이어하기 resumes with same session id', ...);
test('loop end quota/auth/stopped shows matching message and review link', ...);
```

- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — 시작 후 화면은 검정 배경에 상태 한 줄(듣는 중/생각 중/말하는 중)만, 큰 글씨. 화면 다시 보일 때 Wake Lock 재요청.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat: hands-free car mode screen`

---

### Task 9: 복습 화면

**Files:**
- Create: `src/ui/review.ts`
- Test: `tests/ui/review.test.ts`

**Interfaces:**
- Consumes: `Db.listSessions/getTurns/topWeakPhrases`, `SCENARIOS`, `speak`
- Produces: `renderReview(root: HTMLElement, deps: { db: Db; speak: typeof speak }, sessionId?: string): void`

- [ ] **Step 1: 실패하는 테스트**

```ts
test('lists sessions newest first with date, scenario title, 집/차 badge', ...);
test('session detail shows each turn: 내가 한 말, 더 자연스러운 표현, 이유, 발음 피드백', ...);
test('better phrase has a listen button that speaks it in en-US', ...);
test('자주 틀린 표현 tab lists top 20 weak phrases with counts', ...);
test('empty state shows 아직 연습 기록이 없어요', ...);
```

- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npx vitest run` 전체 PASS
- [ ] **Step 5: Commit** — `feat: review screen with weak phrases`

---

### Task 10: 배포 + 아이폰 최종 확인

**Files:**
- Modify: 필요 시 `src/config.ts` (기준값 조정)

- [ ] **Step 1: 빌드 확인** — Run: `npm run build` → 오류 없음, `dist/index.html` 생성
- [ ] **Step 2: 전체 테스트** — Run: `npx vitest run` → 모두 PASS
- [ ] **Step 3: 배포** — main 푸시(사용자 확인 후) → Actions 성공 확인
- [ ] **Step 4: 🚦 사용자 아이폰 최종 확인**

| # | 시나리오 | 통과 기준 |
|---|---|---|
| 1 | 첫 실행 | 설정 화면으로 이동, 키 입력 후 홈 |
| 2 | 집 모드 1·2·3단계 각 3턴 | 교정은 끝난 뒤 요약에만 자세히 나옴 |
| 3 | 차 모드 출퇴근 1회 | 시작 후 한 번도 화면·버튼을 만지지 않음. 음성 명령 7개 모두 동작 |
| 4 | 터널 등 끊김 | 안내 1번, 연결 후 이어짐 |
| 5 | 복습 | 차에서 한 대화와 교정이 보임, 자주 틀린 표현이 다음 대화에 다시 나옴 |
| 6 | 백업 | 내보낸 파일을 가져와도 기록 유지, 깨진 파일은 거부 |

- [ ] **Step 5: Commit** — `chore: tune thresholds after device testing` (변경이 있을 때만)
