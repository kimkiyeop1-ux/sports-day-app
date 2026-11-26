// =============================================================
// 점수·순위 엔진 (관리자 브라우저에서만 실행 — 단위 테스트: scoring.test.ts)
//
//  종목 점수 = (순위 점수 + 참가점) × 가중치
//  학급 총점 = 종목 점수 합 + 경기 외 점수(응원·질서 등, 감점 항목은 빼기)
//  종합 순위 = 총점 높은 순 → 동점이면 동점 규칙을 위에서부터 차례로 → 그래도 같으면 공동 순위
// =============================================================
import type { ClassId, EventConfig, TournamentConfig } from '../config/types';
import { allClasses, gradeOf } from '../config/derive';
import type { FinalRank } from './bracket';

/** 공동 순위일 때 순위 점수: same = 그 순위 점수 그대로 / average = 차지한 자리들의 평균 */
export type SharedRankPoints = 'same' | 'average';

/** 경기 외 점수: 항목ID → 학급 → 점수(감점 항목도 양수로 입력, 계산할 때 뺌) */
export type BonusMap = Record<string, Record<ClassId, number>>;

export interface EventScore {
  /** 종목 순위(null = 아직 확정 안 됨 또는 대진표 없음) */
  rank: number | null;
  /** 종목 점수(순위 확정 전에는 0) */
  points: number;
}

export interface ScoreRow {
  id: ClassId;
  events: Record<string, EventScore>;
  bonus: Record<string, number>;
  bonusTotal: number;
  eventTotal: number;
  total: number;
}

export interface RankedRow extends ScoreRow {
  rank: number;
  /** 같은 총점이었는데 동점 규칙으로 순서가 정해졌다면 그 규칙 이름 */
  decidedBy?: string;
  /** 모든 동점 규칙으로도 갈리지 않아 공동 순위 */
  shared: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 순위 → 순위 점수 */
export function rankPoints(byRank: number[], rank: number, sharedCount: number, mode: SharedRankPoints): number {
  if (mode === 'average' && sharedCount > 1) {
    let sum = 0;
    for (let i = 0; i < sharedCount; i++) sum += byRank[rank - 1 + i] ?? 0;
    return sum / sharedCount;
  }
  return byRank[rank - 1] ?? 0;
}

/**
 * 한 종목의 학급별 점수.
 * @param ranks 대진단위별 최종 순위를 모두 합친 목록(학년별 종목이면 학년마다 1위가 있음)
 * @param divisionOf 학급 → 대진단위(공동 순위 인원 계산용)
 */
export function eventScores(
  ev: EventConfig,
  ranks: FinalRank[],
  mode: SharedRankPoints = 'same',
  divisionOf: (id: ClassId) => string = () => 'all',
): Record<ClassId, EventScore> {
  const p = ev.points;
  const count: Record<string, number> = {};
  for (const r of ranks) if (r.rank != null) count[`${divisionOf(r.id)}#${r.rank}`] = (count[`${divisionOf(r.id)}#${r.rank}`] ?? 0) + 1;
  const out: Record<ClassId, EventScore> = {};
  for (const r of ranks) {
    if (r.rank == null) {
      out[r.id] = { rank: null, points: 0 };
      continue;
    }
    const base = rankPoints(p.byRank, r.rank, count[`${divisionOf(r.id)}#${r.rank}`] ?? 1, mode);
    out[r.id] = { rank: r.rank, points: round2((base + (p.participation ?? 0)) * (p.weight ?? 1)) };
  }
  return out;
}

/** 학급별 총점 계산 */
export function computeScores(
  cfg: Pick<TournamentConfig, 'grades' | 'events' | 'scoring'>,
  ranksByEvent: Record<string, FinalRank[]>,
  bonus: BonusMap,
  mode: SharedRankPoints = 'same',
): ScoreRow[] {
  const classes = allClasses(cfg);
  const perEvent: Record<string, Record<ClassId, EventScore>> = {};
  for (const ev of cfg.events) {
    const divOf = (id: ClassId) => (ev.scope === 'school' ? 'all' : `g${gradeOf(id)}`);
    perEvent[ev.id] = eventScores(ev, ranksByEvent[ev.id] ?? [], mode, divOf);
  }
  return classes.map((id) => {
    const events: Record<string, EventScore> = {};
    let eventTotal = 0;
    for (const ev of cfg.events) {
      // 참가하는 종목인데 아직 대진표·순위가 없으면 '미정'. 참가하지 않는 종목(다른 학년 종목)은 기록하지 않음
      const s = perEvent[ev.id][id] ?? (ev.grades.includes(gradeOf(id)) ? { rank: null, points: 0 } : undefined);
      if (s) {
        events[ev.id] = s;
        eventTotal += s.points;
      }
    }
    const b: Record<string, number> = {};
    let bonusTotal = 0;
    for (const cat of cfg.scoring.bonusCategories) {
      const v = Number(bonus[cat.id]?.[id] ?? 0) || 0;
      b[cat.id] = v;
      bonusTotal += cat.negative ? -Math.abs(v) : v;
    }
    eventTotal = round2(eventTotal);
    bonusTotal = round2(bonusTotal);
    return { id, events, bonus: b, bonusTotal, eventTotal, total: round2(eventTotal + bonusTotal) };
  });
}

// ---------------- 동점 규칙 ----------------

export interface TieBreakerInfo {
  key: string;
  label: string;
}

/** 쓸 수 있는 동점 규칙 목록 */
export function tieBreakerOptions(cfg: Pick<TournamentConfig, 'events' | 'scoring'>): TieBreakerInfo[] {
  return [
    { key: 'mostFirstPlaces', label: '종목 1위를 많이 한 학급' },
    { key: 'mostSecondPlaces', label: '종목 2위를 많이 한 학급' },
    { key: 'mostThirdPlaces', label: '종목 3위를 많이 한 학급' },
    { key: 'eventTotal', label: '경기 점수(경기 외 점수 제외) 합이 높은 학급' },
    ...cfg.events.map((e) => ({ key: `event:${e.id}`, label: `${e.name} 순위가 높은 학급` })),
    ...cfg.scoring.bonusCategories.map((c) => ({
      key: `bonus:${c.id}`,
      label: c.negative ? `${c.name}이(가) 적은 학급` : `${c.name}이(가) 높은 학급`,
    })),
  ];
}

export function tieBreakerLabel(cfg: Pick<TournamentConfig, 'events' | 'scoring'>, key: string): string {
  return tieBreakerOptions(cfg).find((o) => o.key === key)?.label ?? key;
}

/** 동점 규칙 하나로 비교할 값(클수록 앞) */
function tbValue(cfg: Pick<TournamentConfig, 'scoring'>, key: string, r: ScoreRow): number {
  const countRank = (n: number) => Object.values(r.events).filter((e) => e.rank === n).length;
  if (key === 'mostFirstPlaces') return countRank(1);
  if (key === 'mostSecondPlaces') return countRank(2);
  if (key === 'mostThirdPlaces') return countRank(3);
  if (key === 'eventTotal') return r.eventTotal;
  if (key.startsWith('event:')) {
    const rank = r.events[key.slice(6)]?.rank;
    return rank == null ? -Infinity : -rank; // 순위 숫자가 작을수록 앞
  }
  if (key.startsWith('bonus:')) {
    const id = key.slice(6);
    const neg = cfg.scoring.bonusCategories.find((c) => c.id === id)?.negative;
    const v = r.bonus[id] ?? 0;
    return neg ? -Math.abs(v) : v;
  }
  return 0;
}

/**
 * 종합 순위. 총점 → 동점 규칙(순서대로) → 공동 순위.
 * 공동 순위 다음은 건너뛴다(1, 2, 2, 4).
 */
export function rankScores(rows: ScoreRow[], cfg: Pick<TournamentConfig, 'events' | 'scoring'>, tieBreakers: string[] = cfg.scoring.tieBreakers): RankedRow[] {
  const keyOf = (r: ScoreRow) => [r.total, ...tieBreakers.map((k) => tbValue(cfg, k, r))];
  const cmp = (x: ScoreRow, y: ScoreRow) => {
    const kx = keyOf(x);
    const ky = keyOf(y);
    for (let i = 0; i < kx.length; i++) if (kx[i] !== ky[i]) return ky[i] - kx[i];
    return 0;
  };
  const sorted = [...rows].sort((x, y) => cmp(x, y) || x.id.localeCompare(y.id, undefined, { numeric: true }));
  const out: RankedRow[] = [];
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    const sameAsPrev = !!prev && cmp(prev, r) === 0;
    const sameAsNext = !!next && cmp(r, next) === 0;
    const rank = sameAsPrev ? out[i - 1].rank : i + 1;
    // 총점이 같은 이웃이 있는데 순위가 갈렸다면, 어떤 규칙으로 갈렸는지 표시
    let decidedBy: string | undefined;
    for (const o of [prev, next]) {
      if (!o || o.total !== r.total || cmp(o, r) === 0) continue;
      const ko = keyOf(o);
      const kr = keyOf(r);
      const idx = ko.findIndex((v, j) => j > 0 && v !== kr[j]);
      if (idx > 0) decidedBy = tieBreakers[idx - 1];
    }
    out.push({ ...r, rank, shared: sameAsPrev || sameAsNext, decidedBy });
  });
  return out;
}

/** 학년별 또는 전교 순위. grade=null 이면 전교 */
export function rankByScope(rows: ScoreRow[], cfg: Pick<TournamentConfig, 'events' | 'scoring'>, grade: number | null): RankedRow[] {
  return rankScores(grade == null ? rows : rows.filter((r) => gradeOf(r.id) === grade), cfg);
}

export const TIE_KEY_RE = /^(mostFirstPlaces|mostSecondPlaces|mostThirdPlaces|eventTotal|event:.+|bonus:.+)$/;
