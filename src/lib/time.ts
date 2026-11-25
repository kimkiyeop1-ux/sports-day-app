/** "HH:MM" → 자정부터의 분. 형식이 틀리면 null */
export function parseHM(hm: string | undefined): number | null {
  if (!hm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function formatHM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 타임스탬프(ms) → 그날 자정부터의 분(기기 현지 시각 기준) */
export function minutesOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

export function clockHM(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 지연(+)/단축(-) 분 → "7분 지연", "3분 빠름", "정시" */
export function delayLabel(diffMin: number): string {
  const d = Math.round(diffMin);
  if (d === 0) return '정시';
  return d > 0 ? `${d}분 지연` : `${-d}분 빠름`;
}
