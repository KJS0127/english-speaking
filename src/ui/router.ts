export type Route =
  | { name: 'home' }
  | { name: 'settings' }
  | { name: 'homeMode'; scenarioId: string }
  | { name: 'carMode'; scenarioId: string }
  | { name: 'review'; sessionId?: string };

export function routeToHash(r: Route): string {
  switch (r.name) {
    case 'home':
      return '#/';
    case 'settings':
      return '#/settings';
    case 'homeMode':
      return `#/home/${encodeURIComponent(r.scenarioId)}`;
    case 'carMode':
      return `#/car/${encodeURIComponent(r.scenarioId)}`;
    case 'review':
      return r.sessionId ? `#/review/${encodeURIComponent(r.sessionId)}` : '#/review';
  }
}

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [a, b] = parts;
  if (a === 'settings' && !b) return { name: 'settings' };
  if (a === 'home' && b) return { name: 'homeMode', scenarioId: b };
  if (a === 'car' && b) return { name: 'carMode', scenarioId: b };
  if (a === 'review') return b ? { name: 'review', sessionId: b } : { name: 'review' };
  return { name: 'home' };
}

export function navigate(r: Route): void {
  location.hash = routeToHash(r);
}

export function onRoute(render: (r: Route) => void): void {
  const run = () => render(parseRoute(location.hash));
  window.addEventListener('hashchange', run);
  run();
}
