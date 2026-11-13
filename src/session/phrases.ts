export const KO = {
  idle: '계속할까요? 준비되면 말해 주세요.',
  hintIntro: '이렇게 말해 보세요.',
  next: '다음 상황으로 넘어갈게요.',
  stop: '연습을 마칠게요. 수고하셨어요.',
  offline: '인터넷 연결이 끊겼어요. 다시 연결되면 이어갈게요.',
  online: '다시 연결됐어요.',
  quota: '오늘 무료 사용량이 끝났어요. 연습을 마칠게요.',
  auth: 'API 키에 문제가 있어요. 집에서 설정을 확인해 주세요.',
  error: '문제가 생겨서 연습을 마칠게요.',
  fatal: '앱 설정에 문제가 있어서 연습을 마칠게요. 집에서 확인해 주세요.',
  badRepeated: '계속 잘 알아듣지 못해서 연습을 마칠게요.',
  goalIntro: '이번 목표예요.',
  goalsLeft: '남은 목표예요.',
  goalOne: '목표 하나 달성!',
  goalAll: '목표 달성!',
  goalsDoneKeepTalking: '목표를 다 이뤘어요. 조금 더 이야기해 봐요.',
  newMission: '새 목표로 넘어갈게요.',
  otherScenario: '다른 상황으로 넘어갈게요.',
  levelUp: (n: number) => `${n}단계로 올라갔어요!`,
  levelDown: (n: number) => `${n}단계로 낮췄어요. 천천히 다시 해 봐요.`,
} as const;

export const EN_RETRY = 'Sorry, could you say that again?';
