import { CONFIG } from '../config';
import type { Db } from '../store/db';
import { h, mount } from './dom';
import { navigate } from './router';

export const PRIVACY_NOTICE = 'Gemini 무료 등급은 입력 내용이 구글 서비스 개선에 쓰일 수 있어요. 개인정보는 말하지 마세요.';
const VOICE_GUIDE =
  '더 자연스러운 목소리: 아이폰 설정 → 손쉬운 사용 → 읽기 및 말하기 → 음성 → 영어에서 "향상된" 또는 "고품질" 음성을 내려받으세요. 한국어 음성도 같은 방법으로 받을 수 있어요.';
const IMPORT_FAIL = '백업 파일을 읽을 수 없어요. 기존 기록은 그대로예요.';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export async function renderSettings(root: HTMLElement, db: Db): Promise<void> {
  const apiKey = (await db.getSetting<string>('apiKey')) ?? '';
  const ttsRate = (await db.getSetting<number>('ttsRate')) ?? CONFIG.ttsRate.normal;
  const status = h('p', { className: 'status', role: 'status' });

  const keyInput = h('input', { name: 'apiKey', type: 'password', autocomplete: 'off', placeholder: 'Gemini API 키 붙여넣기' });
  keyInput.value = apiKey;
  const rateInput = h('input', { name: 'ttsRate', type: 'range', min: 0.5, max: 1.2, step: 0.05 });
  rateInput.value = String(ttsRate);

  const form = h(
    'form',
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const key = keyInput.value.trim();
        if (!key) {
          status.textContent = 'API 키를 입력해 주세요.';
          return;
        }
        await db.setSetting('apiKey', key);
        await db.setSetting('ttsRate', Number(rateInput.value));
        status.textContent = '저장했어요.';
        if (!apiKey) navigate({ name: 'home' });
      },
    },
    h('label', {}, 'Gemini API 키', keyInput),
    h('p', { className: 'hint' }, 'aistudio.google.com 에서 무료로 발급받을 수 있어요. 키는 이 휴대폰 안에만 저장돼요.'),
    h('label', {}, 'AI 목소리 속도', rateInput),
    h('button', { type: 'submit', className: 'primary' }, '저장'),
  );

  const importInput = h('input', { type: 'file', name: 'import', accept: 'application/json,.json' });
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      await db.importBackup(await file.text());
      status.textContent = '백업을 가져왔어요.';
    } catch {
      status.textContent = IMPORT_FAIL;
    }
    importInput.value = '';
  });

  const exportBtn = h(
    'button',
    {
      type: 'button',
      'data-action': 'export',
      onclick: async () => {
        const blob = new Blob([await db.exportBackup()], { type: 'application/json' });
        const a = h('a', { href: URL.createObjectURL(blob), download: `speaking-backup-${today()}.json` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
    },
    '백업 내보내기',
  );

  mount(
    root,
    h('header', {}, h('a', { href: '#/', className: 'back' }, '← 홈'), h('h1', {}, '설정')),
    form,
    status,
    h('section', { className: 'notice' }, h('p', {}, PRIVACY_NOTICE), h('p', {}, VOICE_GUIDE)),
    h('section', {}, h('h2', {}, '백업'), exportBtn, h('label', { className: 'file' }, '백업 가져오기', importInput)),
  );
}
