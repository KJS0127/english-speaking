import type { Scenario } from './scenarios';

export interface Mission {
  titleKo: string;
  goals: string[]; // Korean, shown to the learner
  situationEn: string; // twist / setting for the AI
  openingLine: string; // AI's first line (English)
  difficulty: number; // 1-5
  source: 'ai' | 'fallback';
}

/** How many goals a mission has at each difficulty (spec 5.2). */
export function goalCountRange(difficulty: number): [number, number] {
  const table: Record<number, [number, number]> = { 1: [1, 2], 2: [2, 2], 3: [2, 3], 4: [3, 3], 5: [3, 4] };
  return table[Math.min(5, Math.max(1, Math.round(difficulty)))];
}

type FallbackDef = { titleKo: string; goals: string[]; situationEn: string };

/** Simple level-independent missions used when AI mission generation fails (spec 5.8). */
export const FALLBACK_MISSIONS: Record<string, FallbackDef[]> = {
  'cafe-order': [
    { titleKo: '좋아하는 음료 주문하기', goals: ['음료 하나를 사이즈까지 정해서 주문하기', '매장에서 먹을지 포장할지 말하기'], situationEn: 'A normal morning at the cafe.' },
    { titleKo: '디저트 추천 받기', goals: ['추천 디저트 물어보기', '음료와 디저트 함께 주문하기'], situationEn: 'The cafe has a new cake today.' },
  ],
  'neighbor-smalltalk': [
    { titleKo: '주말 이야기 나누기', goals: ['내 주말 계획 하나 말하기', '이웃에게 질문 하나 하기'], situationEn: 'It is Friday evening.' },
  ],
  'restaurant-booking': [
    { titleKo: '저녁 예약하기', goals: ['날짜·시간·인원 말하기', '예약자 이름 알려주기'], situationEn: 'The restaurant is fairly busy this week.' },
  ],
  'clinic-checkin': [
    { titleKo: '진료 접수하기', goals: ['증상 하나 설명하기', '예약 여부 말하기'], situationEn: 'The clinic is quiet this morning.' },
  ],
  'airport-checkin': [
    { titleKo: '체크인하고 좌석 고르기', goals: ['원하는 좌석(창가/복도) 말하기', '부칠 짐 개수 말하기'], situationEn: 'A normal check-in for an international flight.' },
  ],
  'hotel-checkin': [
    { titleKo: '호텔 체크인하기', goals: ['예약자 이름 말하기', '조식 시간 물어보기'], situationEn: 'The guest arrives in the afternoon.' },
  ],
  'ask-directions': [
    { titleKo: '지하철역 가는 길 묻기', goals: ['가장 가까운 지하철역 위치 묻기', '걸어서 얼마나 걸리는지 묻기'], situationEn: 'Downtown in a foreign city.' },
  ],
  'travel-restaurant': [
    { titleKo: '현지 음식 주문하기', goals: ['추천 메뉴 물어보기', '음식 하나와 음료 하나 주문하기'], situationEn: 'A busy local restaurant at dinner time.' },
  ],
  'self-intro': [
    { titleKo: '내 업무 소개하기', goals: ['내 역할 한 문장으로 말하기', '상대 팀에 대해 질문 하나 하기'], situationEn: 'First meeting with a partner company colleague.' },
  ],
  'meeting-opinion': [
    { titleKo: '일정에 대한 의견 말하기', goals: ['일정에 대한 내 의견 말하기', '이유 하나 설명하기'], situationEn: 'The project schedule is a little tight.' },
  ],
  'schedule-call': [
    { titleKo: '미팅 시간 정하기', goals: ['가능한 요일과 시간 말하기', '정해진 시간 다시 확인하기'], situationEn: 'Both sides are busy next week.' },
  ],
  'email-to-meeting': [
    { titleKo: '이메일 문장 말로 바꾸기', goals: ['이메일 문장 하나를 회의 말투로 말하기', '두 번째 문장도 말로 바꾸기'], situationEn: 'Practice with typical project update emails.' },
  ],
  'free-talk': [
    { titleKo: '오늘 하루 이야기하기', goals: ['오늘 한 일 하나 말하기', '상대에게 질문 하나 하기'], situationEn: 'A relaxed chat at the end of the day.' },
  ],
};

export function fallbackMission(scenario: Scenario, difficulty: number, recentTitles: string[]): Mission {
  const list = FALLBACK_MISSIONS[scenario.id] ?? [
    { titleKo: `${scenario.titleKo} 연습`, goals: ['상대 질문에 두 번 대답하기'], situationEn: 'A normal situation.' },
  ];
  const pick = list.find((m) => !recentTitles.includes(m.titleKo)) ?? list[0];
  return { ...pick, goals: [...pick.goals], openingLine: scenario.openingLine, difficulty, source: 'fallback' };
}

/** How the AI should talk at each difficulty (spec 5.3). */
export const DIFFICULTY_DESC: Record<number, string> = {
  1: 'Very short, simple sentences and basic words. No surprises.',
  2: 'Simple sentences, one question at a time.',
  3: 'Normal-length sentences. Add one unexpected question or a small problem (sold out, a mix-up).',
  4: 'Natural sentences with some common idioms. The learner must solve a problem or explain a choice.',
  5: 'Near-native speed and expressions, indirect wording. Include negotiation, a complaint, or giving reasons.',
};
