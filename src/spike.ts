// Throwaway iPhone check page (plan Task 3). Not part of the app.
import { openMic } from './audio/mic';
import { speak, unlockSpeech } from './audio/speaker';
import { encodeWav } from './audio/wav';
import { sendTurn } from './ai/gemini';
import { findScenario } from './scenarios';
import { CONFIG } from './config';
import type { HistoryItem } from './ai/prompt';

const $ = (id: string) => document.getElementById(id)!;
const keyInput = $('key') as HTMLInputElement;
const stats = $('stats');
const logEl = $('log');

try {
  keyInput.value = localStorage.getItem('spikeKey') ?? '';
} catch {
  /* storage unavailable */
}

const state = { turns: 0, latencies: [] as number[], wake: '확인 전', errors: 0 };
const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

function render() {
  const avg = state.latencies.length ? Math.round(state.latencies.reduce((a, b) => a + b, 0) / state.latencies.length) : 0;
  stats.innerHTML = [
    `홈 화면 앱 모드: <b>${standalone ? '예' : '아니오 (사파리에서 열림)'}</b>`,
    `화면 켜짐 유지: <b>${state.wake}</b>`,
    `손 안 대고 연속 성공 턴: <b>${state.turns}</b>`,
    `평균 응답 시간: <b>${avg ? (avg / 1000).toFixed(1) + '초' : '-'}</b>`,
    `오류 수: <b>${state.errors}</b>`,
  ].join('<br>');
}
function log(msg: string) {
  logEl.textContent = `${new Date().toLocaleTimeString()} ${msg}\n` + logEl.textContent;
}

let wakeLock: { release(): Promise<void> } | null = null;
async function requestWake() {
  try {
    wakeLock = await (navigator as any).wakeLock.request('screen');
    state.wake = '동작 중';
  } catch (e) {
    state.wake = `안 됨 (${(e as Error).name ?? e})`;
  }
  render();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLock) void requestWake();
});

$('start').addEventListener('click', async () => {
  const key = keyInput.value.trim();
  if (!key) return alert('API 키를 입력해 주세요.');
  try {
    localStorage.setItem('spikeKey', key);
  } catch {
    /* ignore */
  }
  ($('start') as HTMLButtonElement).disabled = true;
  unlockSpeech();
  await requestWake();
  let mic;
  try {
    mic = await openMic();
    log('마이크 열림');
  } catch (e) {
    log(`마이크 실패: ${e}`);
    state.errors++;
    render();
    return;
  }
  const scenario = findScenario('free-talk')!;
  const history: HistoryItem[] = [{ role: 'ai', text: scenario.openingLine }];
  await speak(scenario.openingLine, { lang: 'en-US', rate: CONFIG.ttsRate.normal });
  for (;;) {
    log('듣는 중…');
    let audio: Float32Array | 'idle';
    try {
      audio = await mic.listen({ idleMs: 20000 });
    } catch (e) {
      state.errors++;
      log(`듣기 중단됨 (전화·Siri 등 오디오 끊김?): ${(e as Error).message}`);
      render();
      ($('start') as HTMLButtonElement).disabled = false;
      return;
    }
    if (audio === 'idle') {
      log('20초 동안 조용함 → 안내 음성 재생 (마이크 꺼진 상태)');
      await speak('계속할까요?', { lang: 'ko-KR', rate: CONFIG.ttsRate.normal });
      continue;
    }
    const wav = encodeWav(audio, CONFIG.sampleRate);
    log(`녹음 ${(audio.length / CONFIG.sampleRate).toFixed(1)}초 → 전송`);
    const t0 = performance.now();
    try {
      const r = await sendTurn({ scenario, mode: 'car', level: 3, history, weakPhrases: [], audioWav: wav }, key);
      state.latencies.push(performance.now() - t0);
      log(`나: ${r.transcript}\nAI: ${r.aiLine}`);
      if (r.transcript.trim()) {
        history.push({ role: 'user', text: r.transcript }, { role: 'ai', text: r.aiLine });
        state.turns++;
      }
      render();
      await speak(r.aiLine, { lang: 'en-US', rate: CONFIG.ttsRate.normal });
    } catch (e) {
      state.errors++;
      log(`오류: ${(e as Error).name} ${(e as Error).message}`.slice(0, 300));
      render();
    }
  }
});

render();
