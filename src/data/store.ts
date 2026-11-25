// =============================================================
// Firestore 데이터 경로와 쓰기 함수
//
//  meta/active                         공개   현재 대회 ID
//  meta/admins                         관리자 관리자 UID 목록(콘솔에서만 수정)
//  tournaments/{t}/private/config      관리자 대회 설정 전체(배점 포함)
//  tournaments/{t}/private/scenario    관리자 시나리오 완료 기록
//  tournaments/{t}/public/info         공개   학급·종목 이름 등(배점 없음)
//  tournaments/{t}/public/progress     공개   진행 순서·완료 여부(방송멘트 없음)
//  tournaments/{t}/private/bracket_{종목} 관리자 대진표·경기 결과 원본
//  tournaments/{t}/public/bracket_{종목}  공개   대진표·경기 결과(승패·스코어만, 배점·종목 순위 없음)
//  tournaments/{t}/audit/{id}          관리자 변경 이력(추가만 가능)
// =============================================================
import { collection, doc, writeBatch, type WriteBatch } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { ClassId, EventConfig, MatchRule, TournamentConfig } from '../config/types';
import type { Division, LeaguePoints, Results } from '../lib/bracket';
import { toPublicInfo } from '../config/derive';
import { toPublicScenario, type DoneMap } from '../lib/scenario';

export const paths = {
  active: 'meta/active',
  admins: 'meta/admins',
  config: (t: string) => `tournaments/${t}/private/config`,
  scenario: (t: string) => `tournaments/${t}/private/scenario`,
  publicInfo: (t: string) => `tournaments/${t}/public/info`,
  publicProgress: (t: string) => `tournaments/${t}/public/progress`,
  audit: (t: string) => `tournaments/${t}/audit`,
  bracket: (t: string, ev: string) => `tournaments/${t}/private/bracket_${ev}`,
  publicBracket: (t: string, ev: string) => `tournaments/${t}/public/bracket_${ev}`,
};

export interface ConfigDoc {
  config: TournamentConfig;
  updatedAt: number;
}
export interface ScenarioDoc {
  done: DoneMap;
}
export interface ProgressDoc {
  items: ReturnType<typeof toPublicScenario>;
  updatedAt: number;
}

/** 변경 이력 한 건을 같은 묶음(batch)에 추가 */
export function addAudit(
  b: WriteBatch,
  t: string,
  entry: { action: string; target: string; before: unknown; after: unknown; actorName?: string },
) {
  const ref = doc(collection(db, paths.audit(t)));
  b.set(ref, {
    at: Date.now(),
    actor: auth.currentUser?.uid ?? 'unknown',
    actorName: entry.actorName ?? '관리자',
    action: entry.action,
    target: entry.target,
    // Firestore는 undefined를 저장할 수 없으므로 JSON 문자열로 보관
    before: JSON.stringify(entry.before ?? null),
    after: JSON.stringify(entry.after ?? null),
  });
}

/** 설정 저장: 관리자용 원본 + 공개용 사본을 한 번에 기록 */
export async function saveConfig(cfg: TournamentConfig, prev: TournamentConfig | null, done: DoneMap) {
  const t = cfg.id;
  const b = writeBatch(db);
  const now = Date.now();
  b.set(doc(db, paths.config(t)), { config: cfg, updatedAt: now } satisfies ConfigDoc);
  b.set(doc(db, paths.publicInfo(t)), { ...toPublicInfo(cfg), updatedAt: now });
  b.set(doc(db, paths.publicProgress(t)), { items: toPublicScenario(cfg.scenario, done), updatedAt: now });
  b.set(doc(db, paths.active), { tournamentId: t });
  addAudit(b, t, { action: prev ? '설정 수정' : '대회 생성', target: 'config', before: prev ? summary(prev) : null, after: summary(cfg) });
  await b.commit();
}

function summary(c: TournamentConfig) {
  return { title: c.title, grades: c.grades, events: c.events.length, scenario: c.scenario.length };
}

/** 시나리오 항목 완료/취소 */
export async function setScenarioDone(cfg: TournamentConfig, done: DoneMap, itemId: string, at: number | null) {
  const t = cfg.id;
  const nextDone: DoneMap = { ...done };
  if (at == null) delete nextDone[itemId];
  else nextDone[itemId] = at;
  const b = writeBatch(db);
  b.set(doc(db, paths.scenario(t)), { done: nextDone } satisfies ScenarioDoc);
  b.set(doc(db, paths.publicProgress(t)), { items: toPublicScenario(cfg.scenario, nextDone), updatedAt: Date.now() });
  const title = cfg.scenario.find((s) => s.id === itemId)?.title ?? itemId;
  addAudit(b, t, {
    action: at == null ? '시나리오 완료 취소' : '시나리오 완료',
    target: `scenario/${itemId} ${title}`,
    before: done[itemId] ?? null,
    after: at,
  });
  // 오프라인이면 기기에 저장되고 재연결 시 자동 전송됨. 화면은 즉시 반영되므로 기다리지 않음.
  b.commit().catch((e) => alert('저장 실패: ' + e.message));
}

// =============================================================
// 대진표
// Firestore는 '배열 안의 배열'을 저장할 수 없어서(조 편성 등) 대진표는 JSON 문자열 하나로 저장한다.
// 종목당 문서 1개 → 전광판·학생 화면의 읽기 횟수를 아낀다.
// =============================================================

/** 대진표·결과 원본(관리자) */
export interface BracketData {
  eventId: string;
  divisions: Division[];
  results: Results;
  /** 순위제 기록: 대진단위 → 학급 → 기록(또는 순위) */
  records: Record<string, Record<ClassId, number>>;
  /** 조 순위 수동 지정(동률 추첨): 대진단위 → 조 번호 → 학급 순서 */
  groupOrder: Record<string, Record<string, ClassId[]>>;
  updatedAt: number;
}

/** 공개용 대진표: 원본 + 화면에 필요한 경기 규칙. 배점·종목 최종 순위는 넣지 않는다 */
export interface PublicBracketData extends BracketData {
  eventName: string;
  rule: MatchRule;
  leaguePoints: LeaguePoints;
  rankBy: 'rank' | 'record_low' | 'record_high';
}

export interface JsonDoc {
  json: string;
  updatedAt: number;
}

export function parseJsonDoc<T>(d: JsonDoc | null): T | null {
  if (!d?.json) return null;
  try {
    return JSON.parse(d.json) as T;
  } catch {
    return null;
  }
}

export function emptyBracket(eventId: string): BracketData {
  return { eventId, divisions: [], results: {}, records: {}, groupOrder: {}, updatedAt: 0 };
}

export function leaguePointsOf(ev: EventConfig): LeaguePoints {
  return { win: ev.points.leagueWin ?? 3, draw: ev.points.leagueDraw ?? 1, loss: ev.points.leagueLoss ?? 0 };
}

export function toPublicBracket(ev: EventConfig, data: BracketData): PublicBracketData {
  // 메모(note)는 관리자 기록이므로 공개본에서 뺀다
  const results: Results = {};
  for (const [k, r] of Object.entries(data.results)) {
    const { note: _note, ...rest } = r;
    results[k] = rest;
  }
  return {
    ...data,
    results,
    eventName: ev.name,
    rule: ev.match,
    leaguePoints: leaguePointsOf(ev),
    rankBy: ev.format.rankBy ?? 'rank',
  };
}

/** 대진표 저장: 원본 + 공개본 + 변경 이력을 한 번에 */
export function saveBracket(
  t: string,
  ev: EventConfig,
  data: BracketData,
  audit: { action: string; target: string; before: unknown; after: unknown },
): Promise<void> {
  const next = { ...data, updatedAt: Date.now() };
  const b = writeBatch(db);
  b.set(doc(db, paths.bracket(t, ev.id)), { json: JSON.stringify(next), updatedAt: next.updatedAt } satisfies JsonDoc);
  const pub = toPublicBracket(ev, next);
  b.set(doc(db, paths.publicBracket(t, ev.id)), { json: JSON.stringify(pub), updatedAt: next.updatedAt } satisfies JsonDoc);
  addAudit(b, t, { ...audit, target: `${ev.name} · ${audit.target}` });
  return b.commit();
}
