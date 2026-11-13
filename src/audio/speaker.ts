export interface SpeakOpts {
  lang: 'en-US' | 'ko-KR';
  rate: number;
}

const HQ = /enhanced|premium|향상된|고품질/i;
const norm = (l: string) => l.replace('_', '-').toLowerCase();

export function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const same = voices.filter((v) => norm(v.lang) === lang.toLowerCase());
  return same.find((v) => HQ.test(v.name)) ?? same[0] ?? null;
}

/** Call inside a tap handler: iOS only allows speech after a user gesture. */
export function unlockSpeech(): void {
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}

export function speak(text: string, opts: SpeakOpts): Promise<void> {
  return new Promise((resolve) => {
    if (!text.trim()) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = opts.lang;
    u.rate = opts.rate;
    const voice = pickVoice(speechSynthesis.getVoices(), opts.lang);
    if (voice) u.voice = voice;
    // iOS sometimes never fires onend; guard with a generous timeout.
    const guard = setTimeout(resolve, 2000 + text.length * 150);
    const done = () => {
      clearTimeout(guard);
      resolve();
    };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking(): void {
  speechSynthesis.cancel();
}
