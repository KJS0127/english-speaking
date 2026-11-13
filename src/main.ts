import './style.css';
import { openMic } from './audio/mic';
import { speak, stopSpeaking, unlockSpeech } from './audio/speaker';
import { sendTurn } from './ai/gemini';
import { findScenario } from './scenarios';
import { openDb } from './store/db';
import { renderCarMode } from './ui/carMode';
import { renderHome } from './ui/home';
import { renderHomeMode } from './ui/homeMode';
import { renderReview } from './ui/review';
import { navigate, onRoute } from './ui/router';
import { renderSettings } from './ui/settings';

async function boot() {
  const root = document.getElementById('app')!;
  const db = await openDb();
  const send = (req: Parameters<typeof sendTurn>[0], key: string, signal?: AbortSignal) =>
    sendTurn(req, key, fetch, signal);
  const wakeLock = 'wakeLock' in navigator ? (navigator as any).wakeLock : undefined;

  onRoute((r) => {
    window.scrollTo(0, 0);
    switch (r.name) {
      case 'settings':
        void renderSettings(root, db);
        break;
      case 'homeMode':
      case 'carMode': {
        const scenario = findScenario(r.scenarioId);
        if (!scenario) return navigate({ name: 'home' });
        if (r.name === 'homeMode') {
          void renderHomeMode(root, { db, mic: openMic, send, speak, unlock: unlockSpeech, stopSpeaking }, scenario);
        } else {
          void renderCarMode(root, { db, mic: openMic, send, speak, unlock: unlockSpeech, stopSpeaking, wakeLock }, scenario);
        }
        break;
      }
      case 'review':
        void renderReview(root, { db, speak }, r.sessionId);
        break;
      default:
        void renderHome(root, db);
    }
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

void boot();
