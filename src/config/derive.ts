import type { ClassId, EventConfig, TournamentConfig } from './types';

/** 설정에서 전체 학급 목록을 만든다. 예: [{grade:2,classCount:3}] → ["2-1","2-2","2-3"] */
export function allClasses(cfg: Pick<TournamentConfig, 'grades'>): ClassId[] {
  const out: ClassId[] = [];
  for (const g of [...cfg.grades].sort((a, b) => a.grade - b.grade)) {
    for (let c = 1; c <= g.classCount; c++) out.push(`${g.grade}-${c}`);
  }
  return out;
}

export function classesOfGrade(cfg: Pick<TournamentConfig, 'grades'>, grade: number): ClassId[] {
  return allClasses(cfg).filter((c) => gradeOf(c) === grade);
}

export function gradeOf(classId: ClassId): number {
  return Number(classId.split('-')[0]);
}

export function classLabel(classId: ClassId): string {
  const [g, c] = classId.split('-');
  return `${g}학년 ${c}반`;
}

export const FORMAT_LABELS: Record<string, string> = {
  single_elim: '토너먼트 (지면 탈락)',
  round_robin: '리그 (모든 반과 한 번씩)',
  groups_knockout: '조별 리그 → 토너먼트',
  ranking: '기록으로 순위 (계주·줄넘기 등)',
};

export function matchRuleLabel(ev: EventConfig): string {
  if (ev.format.type === 'ranking') return '순위 기록';
  if (ev.match.mode === 'sets') {
    const n = ev.match.setsToWin ?? 2;
    return `${n * 2 - 1}판 ${n}선승`;
  }
  return ev.match.allowDraw ? '점수제(무승부 가능)' : '점수제';
}

// ---------------------------------------------------------------
// 공개용 정보: 배점·동점규칙·방송멘트를 '제거'한 사본.
// 전광판/학생 화면은 오직 이 데이터만 읽는다.
// ---------------------------------------------------------------
export interface PublicEventInfo {
  id: string;
  name: string;
  scope: 'grade' | 'school';
  grades: number[];
  formatType: string;
  matchLabel: string;
  location: string;
}

export interface PublicInfo {
  tournamentId: string;
  title: string;
  school: string;
  date: string;
  classes: ClassId[];
  events: PublicEventInfo[];
}

export function toPublicInfo(cfg: TournamentConfig): PublicInfo {
  return {
    tournamentId: cfg.id,
    title: cfg.title,
    school: cfg.school,
    date: cfg.date,
    classes: allClasses(cfg),
    events: cfg.events.map((e) => ({
      id: e.id,
      name: e.name,
      scope: e.scope,
      grades: e.grades,
      formatType: e.format.type,
      matchLabel: matchRuleLabel(e),
      location: e.location ?? '',
    })),
  };
}
