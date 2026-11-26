// =============================================================
// Firestore 데이터 경로와 쓰기 함수
//
//  meta/active                         공개   현재 대회 ID
//  meta/admins                         관리자 관리자 UID 목록(콘솔에서만 수정)
//  tournaments/{t}/private/config      관리자 대회 설정 전체(배점 포함)
//  tournaments/{t}/private/scenario    관리자 시나리오 완료 기록
//  tournaments/{t}/public/info         공개   학급·종목 이름 등(배점 없음)
//  tournaments/{t}/public/progress     공개   진행 순서·완료 여부(방송멘트 없음)
//  tournaments/{t}/private/bracket_{종목} 관리자 대진표 원본(조 순위 수동 지정 포함)
//  tournaments/{t}/public/bracket_{종목}  공개   대진표 구조(배점·종목 순위 없음)
//  tournaments/{t}/public/results_{종목}  공개   경기 결과·기록(승패·스코어). 관리자와 그 종목 심판만 쓰기
//  tournaments/{t}/private/notes_{종목}   관리자 경기 메모
//  tournaments/{t}/private/referee        관리자 종목별 심판 링크 토큰·PIN
//  tournaments/{t}/refSessions/{uid}      심판   PIN 확인된 심판 기기(이름 포함)
//  tournaments/{t}/private/bonus          관리자 경기 외 점수(응원·질서·감점)
//  tournaments/{t}/audit/{id}          관리자 변경 이력(추가만 가능)
// =============================================================
import { collection, doc, FieldPath, writeBatch, type WriteBatch } from 'firebase/firestore';
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
  results: (t: string, ev: string) => `tournaments/${t}/public/results_${ev}`,
  notes: (t: string, ev: string) => `tournaments/${t}/private/notes_${ev}`,
  refKeys: (t: string) => `tournaments/${t}/private/referee`,
  refSessions: (t: string) => `tournaments/${t}/refSessions`,
  refSession: (t: string, uid: string) => `tournaments/${t}/refSessions/${uid}`,
  bonus: (t: string) => `tournaments/${t}/private/bonus`,
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
  entry: { action: string; target: string; before: unknown; after: unknown; actorName?: string; extra?: Record<string, string> },
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
    ...(entry.extra ?? {}),
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
  /** 결과 문서를 통째로 바꿀 때(대진표 다시 만들기·자리 수정 등) */
  resetResults?: { results: Results; records: Records },
): Promise<void> {
  // 결과·기록은 public/results_{종목}에 저장한다. 대진표 문서에는 남기지 않는다(2단계 형식 → 3단계 형식으로 옮김)
  const next = { ...data, results: {}, records: {}, updatedAt: Date.now() };
  const b = writeBatch(db);
  if (resetResults) {
    b.set(doc(db, paths.results(t, ev.id)), {
      r: Object.fromEntries(Object.entries(resetResults.results).map(([k, v]) => [k, JSON.stringify(v)])),
      rec: resetResults.records,
      updatedAt: next.updatedAt,
    } satisfies ResultsDoc);
  }
  b.set(doc(db, paths.bracket(t, ev.id)), { json: JSON.stringify(next), updatedAt: next.updatedAt } satisfies JsonDoc);
  const pub = toPublicBracket(ev, next);
  b.set(doc(db, paths.publicBracket(t, ev.id)), { json: JSON.stringify(pub), updatedAt: next.updatedAt } satisfies JsonDoc);
  addAudit(b, t, { ...audit, target: `${ev.name} · ${audit.target}` });
  return b.commit();
}

// =============================================================
// 경기 결과·기록 (3단계: 심판도 쓰는 문서)
// public/results_{종목}:
//   r   : 경기ID → 결과(JSON 문자열). "{}" = 결과 없음(지움)
//   rec : 대진단위 → 학급 → 기록(순위제)
// 경기마다 칸이 따로라서 여러 심판이 동시에 입력해도 서로 덮어쓰지 않는다.
// =============================================================

export type Records = Record<string, Record<ClassId, number>>;

export interface ResultsDoc {
  r?: Record<string, string>;
  rec?: Records;
  updatedAt?: number;
}

/** 결과 문서 → 결과·기록. (2단계 때 대진표 문서에 저장된 예전 결과가 있으면 합친다) */
export function readResults(doc: ResultsDoc | null, legacy?: { results?: Results; records?: Records } | null): { results: Results; records: Records } {
  const results: Results = { ...(legacy?.results ?? {}) };
  for (const [k, v] of Object.entries(doc?.r ?? {})) {
    try {
      results[k] = JSON.parse(v);
    } catch {
      /* 무시 */
    }
  }
  const records: Records = { ...(legacy?.records ?? {}) };
  for (const [k, v] of Object.entries(doc?.rec ?? {})) records[k] = v ?? {};
  return { results, records };
}

export interface Actor {
  /** 이력에 남는 이름(관리자 / 심판 선생님 이름) */
  name: string;
}

/** 경기 결과 한 건 저장(관리자·심판 공용). after=null 이면 결과 지우기 */
export function writeMatchResult(
  t: string,
  ev: { id: string; name: string },
  matchId: string,
  target: string,
  action: string,
  before: unknown,
  after: unknown,
  actor: Actor,
): Promise<void> {
  const b = writeBatch(db);
  const now = Date.now();
  b.set(
    doc(db, paths.results(t, ev.id)),
    { r: { [matchId]: JSON.stringify(after ?? {}) }, updatedAt: now },
    { mergeFields: [new FieldPath('r', matchId), 'updatedAt'] },
  );
  addAudit(b, t, {
    action,
    target: `${ev.name} · ${target}`,
    before,
    after,
    actorName: actor.name,
    extra: { kind: 'result', ev: ev.id, matchId },
  });
  return b.commit();
}

/** 순위제 기록 저장(대진단위 하나 전체를 바꿈) */
export function writeRecords(
  t: string,
  ev: { id: string; name: string },
  div: string,
  target: string,
  before: Record<ClassId, number>,
  after: Record<ClassId, number>,
  actor: Actor,
): Promise<void> {
  const b = writeBatch(db);
  const now = Date.now();
  b.set(
    doc(db, paths.results(t, ev.id)),
    { rec: { [div]: after }, updatedAt: now },
    { mergeFields: [new FieldPath('rec', div), 'updatedAt'] },
  );
  addAudit(b, t, {
    action: '기록 입력',
    target: `${ev.name} · ${target}`,
    before,
    after,
    actorName: actor.name,
    extra: { kind: 'records', ev: ev.id, div },
  });
  return b.commit();
}

/** 관리자 경기 메모(비공개) */
export function writeNote(t: string, evId: string, matchId: string, note: string): Promise<void> {
  const b = writeBatch(db);
  b.set(doc(db, paths.notes(t, evId)), { n: { [matchId]: note } }, { mergeFields: [new FieldPath('n', matchId)] });
  return b.commit();
}

// ---------------- 심판 링크 ----------------

export interface RefKey {
  token: string;
  pin: string;
}
export interface RefKeysDoc {
  keys: Record<string, RefKey>;
}
export interface RefSessionDoc {
  ev: string;
  token: string;
  pin: string;
  name: string;
  at: number;
}

function randomToken(len = 22): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (x) => abc[x % abc.length]).join('');
}
function randomPin(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, '0');
}

/** 종목 심판 링크·PIN 새로 만들기(예전 링크·PIN·심판 기기는 모두 무효가 됨) */
export function createRefKey(t: string, ev: { id: string; name: string }, prev: RefKey | undefined): Promise<void> {
  const key: RefKey = { token: randomToken(), pin: randomPin() };
  const b = writeBatch(db);
  b.set(doc(db, paths.refKeys(t)), { keys: { [ev.id]: key } }, { mergeFields: [new FieldPath('keys', ev.id)] });
  // 심판이 결과를 쓸 문서가 미리 있어야 한다(심판은 '수정'만 가능)
  b.set(doc(db, paths.results(t, ev.id)), { updatedAt: Date.now() }, { merge: true });
  addAudit(b, t, {
    action: prev ? '심판 링크·PIN 새로 만들기' : '심판 링크·PIN 만들기',
    target: ev.name,
    before: null,
    after: null,
    extra: { kind: 'refkey', ev: ev.id },
  });
  return b.commit();
}

// =============================================================
// 경기 외 점수 (4단계) — 관리자 전용 private/bonus
//   v : 항목ID → 학급 → 점수 (감점 항목도 양수로 저장, 계산할 때 뺌)
// =============================================================

export interface BonusDoc {
  v?: Record<string, Record<ClassId, number>>;
  updatedAt?: number;
}

export function writeBonus(
  t: string,
  cat: { id: string; name: string },
  before: Record<ClassId, number>,
  after: Record<ClassId, number>,
  action = '경기 외 점수 입력',
): Promise<void> {
  const b = writeBatch(db);
  b.set(doc(db, paths.bonus(t)), { v: { [cat.id]: after }, updatedAt: Date.now() }, { mergeFields: [new FieldPath('v', cat.id), 'updatedAt'] });
  addAudit(b, t, { action, target: cat.name, before, after, extra: { kind: 'bonus', cat: cat.id } });
  return b.commit();
}
