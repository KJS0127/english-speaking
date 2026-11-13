import './style.css';
import { openDb } from './store/db';
import { onRoute } from './ui/router';
import { renderHome } from './ui/home';
import { renderSettings } from './ui/settings';

async function boot() {
  const root = document.getElementById('app')!;
  const db = await openDb();
  onRoute((r) => {
    switch (r.name) {
      case 'settings':
        void renderSettings(root, db);
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
