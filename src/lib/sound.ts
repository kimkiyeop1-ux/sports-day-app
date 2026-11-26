// =============================================================
// 효과음 (최종 순위 발표용)
// 기본은 브라우저에서 직접 만든 소리(WebAudio). 음원 파일로 바꾸려면 public/sounds/ 에
// drumroll.mp3 · cymbal.mp3 · ding.mp3 · fanfare.mp3 를 넣으면 그 파일을 대신 재생한다.
// =============================================================

type Name = 'drumroll' | 'cymbal' | 'ding' | 'fanfare';

let ctx: AudioContext | null = null;
function ac(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** 첫 클릭 때 호출(브라우저는 사용자 동작 전에는 소리를 막는다) */
export function unlockAudio() {
  try {
    ac();
  } catch {
    /* 소리 미지원 */
  }
}

// ---------- 음원 파일(있으면 우선) ----------
const fileState: Partial<Record<Name, HTMLAudioElement | null>> = {};
function loadFile(name: Name): Promise<HTMLAudioElement | null> {
  if (name in fileState) return Promise.resolve(fileState[name] ?? null);
  return new Promise((resolve) => {
    const a = new Audio(`sounds/${name}.mp3`);
    const done = (ok: boolean) => {
      fileState[name] = ok ? a : null;
      resolve(ok ? a : null);
    };
    a.addEventListener('canplaythrough', () => done(true), { once: true });
    a.addEventListener('error', () => done(false), { once: true });
    setTimeout(() => !(name in fileState) && done(false), 1500);
    a.load();
  });
}
/** 발표 화면을 열 때 미리 확인 */
export function preloadSounds() {
  (['drumroll', 'cymbal', 'ding', 'fanfare'] as Name[]).forEach((n) => void loadFile(n));
}

function playFile(a: HTMLAudioElement, maxMs?: number): Promise<void> {
  return new Promise((resolve) => {
    a.currentTime = 0;
    const end = () => resolve();
    a.addEventListener('ended', end, { once: true });
    a.play().catch(end);
    if (maxMs) setTimeout(() => { a.pause(); end(); }, maxMs);
  });
}

// ---------- 합성음 ----------
function noiseBuffer(c: AudioContext, sec: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * sec), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function synthDrumroll(sec: number): Promise<void> {
  const c = ac();
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, sec);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 900;
  bp.Q.value = 0.8;
  const g = c.createGain();
  // 스네어 연타: 빠르게 떨리는 음량 + 점점 크게
  const hits = Math.floor(sec * 22);
  g.gain.setValueAtTime(0, t);
  for (let i = 0; i < hits; i++) {
    const at = t + i / 22;
    const vol = 0.15 + 0.5 * (i / hits);
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.02, at + 0.04);
  }
  src.connect(bp).connect(g).connect(c.destination);
  src.start(t);
  src.stop(t + sec);
  return new Promise((r) => setTimeout(r, sec * 1000));
}

function synthCymbal() {
  const c = ac();
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 1.6);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 5000;
  const g = c.createGain();
  g.gain.setValueAtTime(0.6, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
  src.connect(hp).connect(g).connect(c.destination);
  src.start(t);
  // 큰북
  const o = c.createOscillator();
  const og = c.createGain();
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.4);
  og.gain.setValueAtTime(0.9, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  o.connect(og).connect(c.destination);
  o.start(t);
  o.stop(t + 0.5);
}

function tone(freq: number, at: number, dur: number, type: OscillatorType = 'triangle', vol = 0.25) {
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.05);
}

function synthDing() {
  const t = ac().currentTime;
  tone(1046.5, t, 0.5, 'sine', 0.3);
  tone(1568, t + 0.08, 0.6, 'sine', 0.15);
}

function synthFanfare() {
  const t = ac().currentTime;
  // 도-미-솔-(높은)도~
  [523.25, 659.25, 783.99].forEach((f, i) => tone(f, t + i * 0.14, 0.18, 'square', 0.12));
  tone(1046.5, t + 0.45, 1.1, 'square', 0.14);
  tone(783.99, t + 0.45, 1.1, 'triangle', 0.1);
  tone(659.25, t + 0.45, 1.1, 'triangle', 0.1);
}

// ---------- 밖에서 쓰는 함수 ----------
export async function playDrumroll(sec = 2.2): Promise<void> {
  try {
    const f = await loadFile('drumroll');
    if (f) return playFile(f, sec * 1000);
    return synthDrumroll(sec);
  } catch {
    return new Promise((r) => setTimeout(r, sec * 1000));
  }
}
export async function playCymbal() {
  try {
    const f = await loadFile('cymbal');
    if (f) void playFile(f);
    else synthCymbal();
  } catch {
    /* 무시 */
  }
}
export async function playDing() {
  try {
    const f = await loadFile('ding');
    if (f) void playFile(f);
    else synthDing();
  } catch {
    /* 무시 */
  }
}
export async function playFanfare() {
  try {
    const f = await loadFile('fanfare');
    if (f) void playFile(f);
    else synthFanfare();
  } catch {
    /* 무시 */
  }
}
