import { CATEGORY_LABEL, SCENARIOS, type Category } from '../scenarios';
import type { Db } from '../store/db';
import { h, mount } from './dom';
import { navigate, routeToHash } from './router';

const ORDER: Category[] = ['daily', 'travel', 'business', 'free'];

export async function renderHome(root: HTMLElement, db: Db): Promise<void> {
  if (!(await db.getSetting<string>('apiKey'))) {
    navigate({ name: 'settings' });
    return;
  }
  const sections = ORDER.map((cat) =>
    h(
      'section',
      { className: 'category' },
      h('h2', {}, CATEGORY_LABEL[cat]),
      ...SCENARIOS.filter((s) => s.category === cat).map((s) =>
        h(
          'div',
          { className: 'card', 'data-scenario': s.id },
          h('div', { className: 'card-title' }, s.titleKo),
          h(
            'div',
            { className: 'card-actions' },
            h('a', { href: routeToHash({ name: 'homeMode', scenarioId: s.id }), className: 'btn' }, '집에서 연습'),
            h('a', { href: routeToHash({ name: 'carMode', scenarioId: s.id }), className: 'btn car' }, '차에서 연습'),
          ),
        ),
      ),
    ),
  );
  mount(
    root,
    h(
      'header',
      {},
      h('h1', {}, '영어 말하기'),
      h('nav', {}, h('a', { href: '#/review' }, '복습'), h('a', { href: '#/settings' }, '설정')),
    ),
    ...sections,
  );
}
