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
//  tournaments/{t}/public/blind           공개   블라인드 중인 종목 표시(결과 공개본 쓰기 금지)
//  tournaments/{t}/hidden/results_{종목}  관리자·그 종목 심판  블라인드 중 결과
//  tournaments/{t}/reveal/{all|g2}        관리자·공개 진행자  최종 순위 발표 자료
//  tournaments/{t}/audit/{id}          관리자 변경 이력(추가만 가능)
// =============================================================
import { collection, doc, FieldPath, getDoc, getDocs, writeBatch, type WriteBatch } from 'firebase/firestore';
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
  blind: (t: string) => `tournaments/${t}/public/blind`,
  hidden: (t: string, ev: string) => `tournaments/${t}/hidden/results_${ev}`,
  revealCol: (t: string) => `tournaments/${t}/reveal`,
  reveal: (t: string, scope: string) => `tournaments/${t}/reveal/${scope}`,
};

/** 공개 진행자(최종 순위 발표) 링크·PIN이 저장되는 키(종목 ID는 '_'로 시작할 수 없어 겹치지 않음) */
export const PRESENTER = '_presenter';

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
export function readResults(
  doc: ResultsDoc | null,
  legacy?: { results?: Results; records?: Records } | null,
  /** 블라인드 중 결과(관리자·심판만). 공개본보다 우선 */
  hidden?: ResultsDoc | null,
): { results: Results; records: Records } {
  const results: Results = { ...(legacy?.results ?? {}) };
  const records: Records = { ...(legacy?.records ?? {}) };
  for (const d of [doc, hidden]) {
    for (const [k, v] of Object.entries(d?.r ?? {})) {
      try {
        results[k] = JSON.parse(v);
      } catch {
        /* 무시 */
      }
    }
    for (const [k, v] of Object.entries(d?.rec ?? {})) records[k] = v ?? {};
  }
  return { results, records };
}

export interface BlindDoc {
  events?: Record<string, boolean>;
  updatedAt?: number;
}
export const isBlind = (b: BlindDoc | null | undefined, ev: string) => !!b?.events?.[ev];

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
  /** 블라인드 중이면 true → 숨김 문서에 저장 */
  hidden = false,
): Promise<void> {
  const b = writeBatch(db);
  const now = Date.now();
  b.set(
    doc(db, hidden ? paths.hidden(t, ev.id) : paths.results(t, ev.id)),
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
  hidden = false,
): Promise<void> {
  const b = writeBatch(db);
  const now = Date.now();
  b.set(
    doc(db, hidden ? paths.hidden(t, ev.id) : paths.results(t, ev.id)),
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
export function createRefKey(t: string, ev: { id: string; name: string }, prev: RefKey | undefined, blind = false): Promise<void> {
  const key: RefKey = { token: randomToken(), pin: randomPin() };
  const b = writeBatch(db);
  b.set(doc(db, paths.refKeys(t)), { keys: { [ev.id]: key } }, { mergeFields: [new FieldPath('keys', ev.id)] });
  // 심판이 결과를 쓸 문서가 미리 있어야 한다(심판은 '수정'만 가능). 블라인드 중이거나 진행자 키면 건너뜀
  if (!blind && ev.id !== PRESENTER) b.set(doc(db, paths.results(t, ev.id)), { updatedAt: Date.now() }, { merge: true });
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

// =============================================================
// 블라인드 · 최종 공개 (5단계)
// =============================================================

/** 블라인드 켜기: 이 순간부터 결과는 hidden/ 에 쌓이고 공개 화면은 지금 상태에서 멈춘다 */
export function blindOn(t: string, evs: { id: string; name: string }[]): Promise<void> {
  const b = writeBatch(db);
  const now = Date.now();
  b.set(
    doc(db, paths.blind(t)),
    { events: Object.fromEntries(evs.map((e) => [e.id, true])), updatedAt: now },
    { mergeFields: [...evs.map((e) => new FieldPath('events', e.id)), 'updatedAt'] },
  );
  addAudit(b, t, { action: '블라인드 켜기', target: evs.map((e) => e.name).join(', '), before: null, after: null, extra: { kind: 'blind' } });
  return b.commit();
}

/** 결과 공개(블라인드 끄기): 숨겨 둔 결과를 공개본에 옮기고 숨김 문서를 지운다. 규칙상 반드시 한 묶음이어야 한다 */
export function blindOff(t: string, evs: { id: string; name: string; hidden: ResultsDoc | null }[]): Promise<void> {
  const b = writeBatch(db);
  const now = Date.now();
  b.set(
    doc(db, paths.blind(t)),
    { events: Object.fromEntries(evs.map((e) => [e.id, false])), updatedAt: now },
    { mergeFields: [...evs.map((e) => new FieldPath('events', e.id)), 'updatedAt'] },
  );
  for (const e of evs) {
    const r = e.hidden?.r ?? {};
    const rec = e.hidden?.rec ?? {};
    const fields = [...Object.keys(r).map((k) => new FieldPath('r', k)), ...Object.keys(rec).map((k) => new FieldPath('rec', k))];
    if (fields.length) b.set(doc(db, paths.results(t, e.id)), { r, rec, updatedAt: now }, { mergeFields: [...fields, 'updatedAt'] });
    b.delete(doc(db, paths.hidden(t, e.id)));
  }
  addAudit(b, t, { action: '결과 공개(블라인드 끄기)', target: evs.map((e) => e.name).join(', '), before: null, after: null, extra: { kind: 'blind' } });
  return b.commit();
}

export interface RevealRow {
  rank: number;
  id: ClassId;
  shared: boolean;
  /** showScores일 때만 */
  total?: number;
}
export interface RevealDoc {
  scope: string; // 'all' | 'g2' …
  title: string; // '전교' | '2학년'
  rows: RevealRow[]; // 1위부터
  showScores: boolean;
  /** 이 순위까지만 발표(예: 3 → 3위부터 1위까지). 0 = 전체 */
  topN: number;
  complete: boolean;
  at: number;
}

export function writeReveal(t: string, d: RevealDoc): Promise<void> {
  const b = writeBatch(db);
  b.set(doc(db, paths.reveal(t, d.scope)), d);
  addAudit(b, t, { action: '최종 순위 발표 자료 만들기', target: d.title, before: null, after: { rows: d.rows.length, complete: d.complete }, extra: { kind: 'reveal' } });
  return b.commit();
}

// =============================================================
// 백업 · 리허설 · 전체 초기화 (6단계)
// =============================================================

/** 대회 하나가 쓰는 모든 문서 경로(설정 제외). 백업·초기화에 사용 */
export function tournamentDocPaths(t: string, cfg: Pick<TournamentConfig, 'events' | 'grades'>): string[] {
  const out = [paths.scenario(t), paths.publicProgress(t), paths.bonus(t), paths.blind(t), paths.reveal(t, 'all')];
  for (const g of cfg.grades) out.push(paths.reveal(t, `g${g.grade}`));
  for (const e of cfg.events)
    out.push(paths.bracket(t, e.id), paths.publicBracket(t, e.id), paths.results(t, e.id), paths.hidden(t, e.id), paths.notes(t, e.id));
  return out;
}

/** 전체 백업(JSON): 설정 + 모든 문서 + 변경 이력 */
export async function collectBackup(t: string, cfg: TournamentConfig): Promise<Record<string, unknown>> {
  const docs: Record<string, unknown> = {};
  for (const p of [paths.config(t), paths.publicInfo(t), paths.refKeys(t), ...tournamentDocPaths(t, cfg)]) {
    const s = await getDoc(doc(db, p));
    if (s.exists()) docs[p] = s.data();
  }
  const audit = await getDocs(collection(db, paths.audit(t)));
  return {
    app: 'sports-day-app',
    backupAt: new Date().toISOString(),
    tournamentId: t,
    docs,
    audit: audit.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

/** 여러 삭제·쓰기를 400개씩 나눠 실행(한 묶음 최대 500개) */
async function commitInChunks(ops: ((b: WriteBatch) => void)[]) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach((op) => op(b));
    await b.commit();
  }
}

/**
 * 대회 기록 전체 초기화: 설정·심판 링크는 남기고, 시나리오 완료·대진표·결과·점수·블라인드·발표 자료·
 * 심판 접속 기록·변경 이력을 모두 지운다(되돌릴 수 없음 → 먼저 백업을 내려받게 한다).
 */
export async function resetTournament(t: string, cfg: TournamentConfig): Promise<void> {
  const ops: ((b: WriteBatch) => void)[] = [];
  // 블라인드 문서와 결과 공개본은 같은 묶음에서 지워야 규칙을 통과하므로 맨 앞에 함께 둔다
  const first = tournamentDocPaths(t, cfg).filter((p) => p !== paths.publicProgress(t));
  const audit = await getDocs(collection(db, paths.audit(t)));
  const sessions = await getDocs(collection(db, paths.refSessions(t)));
  const firstBatch = writeBatch(db);
  for (const p of first) firstBatch.delete(doc(db, p));
  firstBatch.set(doc(db, paths.publicProgress(t)), { items: toPublicScenario(cfg.scenario, {}), updatedAt: Date.now() });
  await firstBatch.commit();
  for (const d of [...audit.docs, ...sessions.docs]) ops.push((b) => b.delete(d.ref));
  await commitInChunks(ops);
  const b = writeBatch(db);
  addAudit(b, t, { action: '전체 초기화', target: cfg.title, before: { audit: audit.size }, after: null, extra: { kind: 'reset' } });
  await b.commit();
}

export const rehearsalId = (id: string) => `${id}-rehearsal`;

/**
 * 리허설 시작: 지금 대회 설정을 복사한 '리허설 대회'를 새로 만들어 현재 대회로 바꾼다.
 * 진짜 대회 기록은 그대로 남는다. 심판·진행자 링크도 복사해 같은 링크로 연습할 수 있다(PIN은 다시 입력).
 */
export async function startRehearsal(cfg: TournamentConfig): Promise<void> {
  const rid = rehearsalId(cfg.id);
  const rcfg: TournamentConfig = { ...cfg, id: rid, title: `[리허설] ${cfg.title}`, rehearsalOf: cfg.id };
  // 지난 리허설 기록이 있으면 먼저 지운다
  await resetTournament(rid, rcfg);
  const keys = await getDoc(doc(db, paths.refKeys(cfg.id)));
  const b = writeBatch(db);
  if (keys.exists()) b.set(doc(db, paths.refKeys(rid)), keys.data());
  await b.commit();
  await saveConfig(rcfg, null, {});
}

/** 리허설 끝내기: 원래 대회로 돌아간다(리허설 기록은 다음 리허설 때 지워짐) */
export async function endRehearsal(cfg: TournamentConfig): Promise<void> {
  if (!cfg.rehearsalOf) return;
  const b = writeBatch(db);
  b.set(doc(db, paths.active), { tournamentId: cfg.rehearsalOf });
  addAudit(b, cfg.id, { action: '리허설 끝내기', target: cfg.title, before: null, after: null, extra: { kind: 'rehearsal' } });
  await b.commit();
}
