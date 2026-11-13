export type Category = 'daily' | 'travel' | 'business' | 'free';

export interface Scenario {
  id: string;
  category: Category;
  titleKo: string;
  setupEn: string; // role-play setup for the AI
  openingLine: string; // AI's first line
}

export const CATEGORY_LABEL: Record<Category, string> = {
  daily: '일상',
  travel: '여행',
  business: '비즈니스',
  free: '자유 대화',
};

export const SCENARIOS: Scenario[] = [
  // daily
  { id: 'cafe-order', category: 'daily', titleKo: '카페에서 주문하기',
    setupEn: 'You are a friendly barista at a coffee shop. The learner is a customer ordering a drink.',
    openingLine: 'Hi there! What can I get for you today?' },
  { id: 'neighbor-smalltalk', category: 'daily', titleKo: '이웃과 가벼운 대화',
    setupEn: 'You are a friendly neighbor meeting the learner in the elevator. Make small talk about the weather, weekend and daily life.',
    openingLine: 'Oh, good morning! Nice weather today, isn\'t it?' },
  { id: 'restaurant-booking', category: 'daily', titleKo: '식당 예약 전화',
    setupEn: 'You are a restaurant host answering the phone. The learner wants to make a reservation. Ask about date, time, number of people and name.',
    openingLine: 'Good afternoon, thank you for calling Bella Cucina. How can I help you?' },
  { id: 'clinic-checkin', category: 'daily', titleKo: '병원 접수하기',
    setupEn: 'You are a receptionist at a clinic. The learner is a patient checking in. Ask about symptoms, appointment and insurance.',
    openingLine: 'Hello, welcome. Do you have an appointment today?' },
  // travel
  { id: 'airport-checkin', category: 'travel', titleKo: '공항 체크인',
    setupEn: 'You are an airline check-in agent. The learner is checking in for an international flight. Ask about passport, baggage and seat preference.',
    openingLine: 'Good morning! May I see your passport, please?' },
  { id: 'hotel-checkin', category: 'travel', titleKo: '호텔 체크인',
    setupEn: 'You are a hotel front desk clerk. The learner is checking in. Ask about the reservation, explain breakfast and Wi-Fi.',
    openingLine: 'Welcome to the Harbor Hotel. Are you checking in?' },
  { id: 'ask-directions', category: 'travel', titleKo: '길 묻기',
    setupEn: 'You are a local person on the street in a foreign city. The learner asks for directions. Give simple directions and landmarks.',
    openingLine: 'Hi, you look a little lost. Can I help you find something?' },
  { id: 'travel-restaurant', category: 'travel', titleKo: '여행지 식당에서 주문하기',
    setupEn: 'You are a waiter at a local restaurant abroad. Take the learner\'s order, recommend dishes and handle the bill.',
    openingLine: 'Good evening! Here is the menu. Can I start you off with something to drink?' },
  // business
  { id: 'self-intro', category: 'business', titleKo: '업무 자기소개',
    setupEn: 'You are a new colleague from an overseas partner company meeting the learner for the first time. Ask about their role, team and work.',
    openingLine: 'Hi, I don\'t think we\'ve met. I\'m Alex from the partner team. What do you do here?' },
  { id: 'meeting-opinion', category: 'business', titleKo: '회의에서 의견 말하기',
    setupEn: 'You are leading a project meeting. Ask the learner for their opinion on the schedule and plan, and ask follow-up questions politely.',
    openingLine: 'Thanks for joining. I\'d love to hear your thoughts on the project schedule. What do you think?' },
  { id: 'schedule-call', category: 'business', titleKo: '일정 조율 전화',
    setupEn: 'You are a client calling the learner to set up a meeting. Negotiate a date and time that works for both.',
    openingLine: 'Hi, this is Jordan. I\'m calling to set up a meeting next week. When are you available?' },
  { id: 'email-to-meeting', category: 'business', titleKo: '이메일 문장을 회의 말투로 말하기',
    setupEn: 'You are a coach. Each turn, give the learner one short formal business-email sentence and ask them to say the same idea out loud as they would in a meeting. Then react naturally and give the next sentence.',
    openingLine: 'Let\'s practice. Here\'s an email sentence: "Please find attached the updated report for your review." How would you say that in a meeting?' },
  // free
  { id: 'free-talk', category: 'free', titleKo: '자유 대화',
    setupEn: 'You are a friendly English conversation partner. Talk about whatever the learner wants. Ask simple follow-up questions.',
    openingLine: 'Hi! What would you like to talk about today?' },
];

export function findScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export function nextScenario(current: Scenario): Scenario {
  const same = SCENARIOS.filter((s) => s.category === current.category);
  const i = same.findIndex((s) => s.id === current.id);
  return same[(i + 1) % same.length];
}
