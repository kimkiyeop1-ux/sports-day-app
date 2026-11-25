// =============================================================
// 대진표 엔진 (화면과 무관한 순수 계산 코드 — 단위 테스트: bracket.test.ts)
//
//  - 대진 생성: 싱글 토너먼트 / 리그 / 조별리그+토너먼트 / 순위제
//  - 결과 판정: 점수제·세트제, 부전승, 무승부, 기권, 승부차기 등 동점 결정, 재경기
//  - 진출 반영: 승자·패자·조 순위를 다음 경기 자리로 자동 연결
//  - 종목 최종 순위 계산(관리자 전용 화면에서만 사용 — 공개 화면에는 표시하지 않음)
//
// 배점(byRank, weight 등)은 이 파일에서 다루지 않는다. 리그 승점(승/무/패)만 받는다.
// =============================================================
import type { ClassId, EventConfig, FormatType, MatchRule, TournamentConfig } from '../config/types';
import { allClasses, classesOfGrade } from '../config/derive';

// ---------------- 자료 구조 ----------------

/** 경기의 한쪽 자리에 누가 들어가는지 */
export type Slot =
  | { t: 'class'; id: ClassId } //  특정 학급
  | { t: 'bye' } //                  부전승(빈 자리)
  | { t: 'win'; m: string } //       m 경기의 승자
  | { t: 'lose'; m: string } //      m 경기의 패자(3·4위전)
  | { t: 'grp'; g: number; r: number }; // g조(0부터) r위(1부터)

export type Stage = 'group' | 'ko' | 'third';

export interface BMatch {
  id: string;
  stage: Stage;
  /** 토너먼트: 1부터 시작하는 라운드 / 리그: 경기 차수 */
  round: number;
  /** 조 번호(0부터). 리그(풀리그)는 0 하나 */
  group?: number;
  label: string;
  a: Slot;
  b: Slot;
}

/** 대진 단위(학년별 종목이면 학년마다 하나, 전교 종목이면 하나) */
export interface Division {
  key: string; // 'g2' 또는 'all'
  title: string; // '2학년' 또는 '전교'
  format: FormatType;
  entrants: ClassId[];
  /** 리그: [전체] / 조별리그: 조별 학급 / 그 외: [] */
  groups: ClassId[][];
  /** 토너먼트 1라운드 자리 순서(2의 거듭제곱 길이). 0-1, 2-3 … 이 서로 맞붙는다 */
  koSlots: Slot[];
  thirdPlace: boolean;
  /** 순위제: 조(함께 뛰는 묶음) */
  heats: ClassId[][];
  matches: BMatch[];
}

/** 경기 결과(입력값). 점수가 없는 결과 = 아직 경기 전(재경기로 지운 경우 포함) */
export interface MatchResult {
  /** 점수제: 득점 / 세트제: 이긴 세트 수 */
  a?: number;
  b?: number;
  /** 세트제: 세트별 점수 [A, B] (선택) */
  sets?: [number, number][];
  /** 기권한 쪽 → 상대 승 */
  forfeit?: 'a' | 'b';
  /** 동점일 때 승부차기·가위바위보 등으로 이긴 쪽 */
  tbWinner?: 'a' | 'b';
  /** 재경기 횟수 */
  replays?: number;
  note?: string;
  at?: number;
}

export type Results = Record<string, MatchResult>;

export const BYE = '__BYE__';
export type Who = ClassId | typeof BYE | null; // null = 아직 정해지지 않음

export interface ResolvedMatch extends BMatch {
  sideA: Who;
  sideB: Who;
  /** waiting: 상대 미정 / ready: 경기 가능 / done: 결과 있음 / bye: 부전승 */
  status: 'waiting' | 'ready' | 'done' | 'bye';
  outcome: 'a' | 'b' | 'draw' | null;
  winner: Who;
  loser: Who;
  result?: MatchResult;
}

export interface StandingRow {
  id: ClassId;
  played: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
  /** 모든 기준이 같아 순서를 기계적으로 정한 경우(추첨 필요) */
  tied: boolean;
}

export interface GroupStanding {
  group: number;
  rows: StandingRow[];
  complete: boolean;
}

export interface LeaguePoints {
  win: number;
  draw: number;
  loss: number;
}

// ---------------- 이름 ----------------

export const groupName = (g: number) => String.fromCharCode(65 + g); // 0 → A

/** 남은 팀 수로 라운드 이름: 2 → 결승, 4 → 4강 … */
export function roundName(teams: number): string {
  return teams === 2 ? '결승' : `${teams}강`;
}

// ---------------- 생성 ----------------

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * 표준 시드 배치: 크기 size인 대진표에서 각 자리에 들어갈 시드 번호(1부터).
 * 1·2번 시드가 결승에서야 만나도록 배치된다. 예) 8 → [1,8,4,5,2,7,3,6]
 */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/** 시드 순 목록 → 1라운드 자리. 학급 수가 모자라면 높은 시드가 부전승을 받는다 */
export function seededSlots(seeds: Slot[]): Slot[] {
  const size = Math.max(2, nextPow2(seeds.length));
  return seedOrder(size).map((s) => seeds[s - 1] ?? { t: 'bye' });
}

/** 리그 대진(서클 방식). 각 학급이 다른 모든 학급과 한 번씩 경기 */
export function roundRobinPairs(n: number): [number, number, number][] {
  const ids = Array.from({ length: n }, (_, i) => i);
  if (n % 2) ids.push(-1); // 홀수면 '쉬는 팀' 추가
  const m = ids.length;
  const out: [number, number, number][] = []; // [차수, i, j]
  const arr = [...ids];
  for (let r = 0; r < m - 1; r++) {
    for (let k = 0; k < m / 2; k++) {
      const x = arr[k];
      const y = arr[m - 1 - k];
      if (x >= 0 && y >= 0) out.push([r + 1, Math.min(x, y), Math.max(x, y)]);
    }
    arr.splice(1, 0, arr.pop()!); // 첫 번째를 고정하고 회전
  }
  return out;
}

/** 조 편성: 시드 순서대로 지그재그(1→A,2→B,3→B,4→A …)로 나눈다 */
export function snakeGroups(entrants: ClassId[], groupCount: number): ClassId[][] {
  const groups: ClassId[][] = Array.from({ length: groupCount }, () => []);
  entrants.forEach((c, i) => {
    const row = Math.floor(i / groupCount);
    const col = i % groupCount;
    groups[row % 2 === 0 ? col : groupCount - 1 - col].push(c);
  });
  return groups;
}

/** 조별리그 → 본선 자리: A1,B1,C1…, A2,B2… 순으로 시드를 매겨 배치(같은 조 1·2위는 결승 전 대결 최소화) */
export function knockoutFromGroups(groupCount: number, advance: number): Slot[] {
  const seeds: Slot[] = [];
  for (let r = 1; r <= advance; r++) for (let g = 0; g < groupCount; g++) seeds.push({ t: 'grp', g, r });
  return seededSlots(seeds);
}

/** 순위제 조 나누기 */
export function makeHeats(entrants: ClassId[], heatSize?: number): ClassId[][] {
  if (!heatSize || heatSize <= 0 || heatSize >= entrants.length) return [entrants];
  const n = Math.ceil(entrants.length / heatSize);
  // 인원을 최대한 고르게(예: 9학급, 4개씩 → 3·3·3)
  const out: ClassId[][] = Array.from({ length: n }, () => []);
  entrants.forEach((c, i) => out[Math.floor((i * n) / entrants.length)].push(c));
  return out;
}

/** 무작위 섞기(추첨). rng를 넣으면 테스트에서 결과를 고정할 수 있다 */
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 조·자리·조편성 정보로 경기 목록을 다시 만든다(수동 수정 후에도 호출) */
export function buildMatches(div: Omit<Division, 'matches'>): BMatch[] {
  const p = div.key;
  const out: BMatch[] = [];
  if (div.format === 'round_robin' || div.format === 'groups_knockout') {
    div.groups.forEach((members, g) => {
      const name = div.format === 'round_robin' ? '리그' : `${groupName(g)}조`;
      roundRobinPairs(members.length).forEach(([round, i, j], k) =>
        out.push({
          id: `${p}-G${g}-${k + 1}`,
          stage: 'group',
          round,
          group: g,
          label: `${name} ${k + 1}경기`,
          a: { t: 'class', id: members[i] },
          b: { t: 'class', id: members[j] },
        }),
      );
    });
  }
  if ((div.format === 'single_elim' || div.format === 'groups_knockout') && div.koSlots.length >= 2) {
    const size = div.koSlots.length;
    let prev: string[] = [];
    let teams = size;
    for (let r = 1; teams >= 2; r++, teams /= 2) {
      const cur: string[] = [];
      for (let k = 0; k < teams / 2; k++) {
        const id = `${p}-R${r}-${k + 1}`;
        const a: Slot = r === 1 ? div.koSlots[2 * k] : { t: 'win', m: prev[2 * k] };
        const b: Slot = r === 1 ? div.koSlots[2 * k + 1] : { t: 'win', m: prev[2 * k + 1] };
        const label = teams === 2 ? '결승' : `${roundName(teams)} ${k + 1}경기`;
        out.push({ id, stage: 'ko', round: r, label, a, b });
        cur.push(id);
      }
      if (teams === 4 && div.thirdPlace) {
        out.push({ id: `${p}-3rd`, stage: 'third', round: r + 1, label: '3·4위전', a: { t: 'lose', m: cur[0] }, b: { t: 'lose', m: cur[1] } });
      }
      prev = cur;
    }
  }
  return out;
}

/** 종목의 대진 단위 목록(학년별이면 학년마다) */
export function divisionsOf(ev: EventConfig, cfg: Pick<TournamentConfig, 'grades'>): { key: string; title: string; entrants: ClassId[] }[] {
  if (ev.scope === 'school') {
    const set = new Set(ev.grades);
    return [{ key: 'all', title: '전교', entrants: allClasses(cfg).filter((c) => set.has(Number(c.split('-')[0]))) }];
  }
  return [...ev.grades].sort((a, b) => a - b).map((g) => ({ key: `g${g}`, title: `${g}학년`, entrants: classesOfGrade(cfg, g) }));
}

/**
 * 대진 자동 생성.
 * @param entrants 시드 순서(추첨 결과). 생략하면 학급 번호 순.
 */
export function createDivision(ev: EventConfig, key: string, title: string, entrants: ClassId[]): Division {
  const f = ev.format;
  const base = { key, title, format: f.type, entrants, groups: [] as ClassId[][], koSlots: [] as Slot[], heats: [] as ClassId[][], thirdPlace: !!f.thirdPlaceMatch };
  switch (f.type) {
    case 'single_elim':
      base.koSlots = seededSlots(entrants.map((id) => ({ t: 'class', id })));
      break;
    case 'round_robin':
      base.groups = [entrants];
      break;
    case 'groups_knockout': {
      const gc = Math.max(1, Math.min(f.groupCount ?? 2, Math.floor(entrants.length / 2) || 1));
      base.groups = snakeGroups(entrants, gc);
      base.koSlots = knockoutFromGroups(gc, Math.max(1, f.advancePerGroup ?? 2));
      break;
    }
    case 'ranking':
      base.heats = makeHeats(entrants, f.heatSize);
      base.thirdPlace = false;
      break;
  }
  return { ...base, matches: buildMatches(base) };
}

/** 종목 전체 대진 생성(대진 단위마다). draw=true면 무작위 추첨 */
export function createEventBracket(ev: EventConfig, cfg: Pick<TournamentConfig, 'grades'>, draw: boolean, rng?: () => number): Division[] {
  return divisionsOf(ev, cfg).map((d) => createDivision(ev, d.key, d.title, draw ? shuffle(d.entrants, rng) : d.entrants));
}

// ---------------- 결과 판정 ----------------

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 결과가 입력되어 있는지(재경기로 지운 경우 false) */
export function hasResult(r: MatchResult | undefined): r is MatchResult {
  return !!r && (r.forfeit != null || (isNum(r.a) && isNum(r.b)));
}

/** 세트 점수 → 이긴 세트 수 */
export function setsWon(sets: [number, number][]): [number, number] {
  let a = 0;
  let b = 0;
  for (const [x, y] of sets) {
    if (x > y) a++;
    else if (y > x) b++;
  }
  return [a, b];
}

/**
 * 결과 검사. 문제가 있으면 한국어 오류 메시지(없으면 null).
 * @param drawAllowed 리그 경기이고 무승부 허용인 경우 true
 */
export function checkResult(rule: MatchRule, r: MatchResult, drawAllowed: boolean): string | null {
  if (r.forfeit) return null;
  if (!isNum(r.a) || !isNum(r.b)) return '양쪽 점수를 모두 입력하세요.';
  if (r.a < 0 || r.b < 0 || !Number.isInteger(r.a) || !Number.isInteger(r.b)) return '점수는 0 이상의 정수여야 합니다.';
  if (rule.mode === 'sets') {
    const need = rule.setsToWin ?? 2;
    if (r.sets?.length) {
      if (r.sets.some(([x, y]) => x === y)) return '세트 점수가 같은 세트가 있습니다. 각 세트는 승패가 나야 합니다.';
      const [sa, sb] = setsWon(r.sets);
      if (sa !== r.a || sb !== r.b) return '세트 점수와 이긴 세트 수가 맞지 않습니다.';
    }
    if (Math.max(r.a, r.b) !== need || Math.min(r.a, r.b) >= need)
      return `세트제(${need * 2 - 1}판 ${need}선승)는 한쪽이 정확히 ${need}세트를 이겨야 합니다.`;
    return null;
  }
  if (r.a === r.b && !r.tbWinner && !drawAllowed) return '동점입니다. 승부차기·추첨 등으로 이긴 쪽을 선택하세요.';
  return null;
}

/** 결과 → 승패. 'a' | 'b' | 'draw' */
export function outcomeOf(r: MatchResult): 'a' | 'b' | 'draw' {
  if (r.forfeit) return r.forfeit === 'a' ? 'b' : 'a';
  const a = r.a ?? 0;
  const b = r.b ?? 0;
  if (a > b) return 'a';
  if (b > a) return 'b';
  return r.tbWinner ?? 'draw';
}

// ---------------- 진행 상황 계산 ----------------

export interface ResolvedDivision {
  matches: ResolvedMatch[];
  byId: Record<string, ResolvedMatch>;
  standings: GroupStanding[];
}

/**
 * 결과를 반영해 각 경기의 실제 대진·승자를 계산한다.
 * @param groupOrder 조 순위 수동 지정(동률 추첨 결과). 키 = 조 번호
 */
export function resolveDivision(
  div: Division,
  results: Results,
  lp: LeaguePoints,
  groupOrder: Record<string, ClassId[]> = {},
): ResolvedDivision {
  const byId: Record<string, ResolvedMatch> = {};
  const defs: Record<string, BMatch> = Object.fromEntries(div.matches.map((m) => [m.id, m]));
  let standings: GroupStanding[] | null = null;

  const getStandings = (): GroupStanding[] => {
    if (standings) return standings;
    standings = div.groups.map((members, g) => {
      const ms = div.matches.filter((m) => m.stage === 'group' && m.group === g).map((m) => res(m.id));
      return computeStanding(g, members, ms, lp, groupOrder[String(g)]);
    });
    return standings;
  };

  const sideOf = (s: Slot): Who => {
    switch (s.t) {
      case 'class':
        return s.id;
      case 'bye':
        return BYE;
      case 'win':
        return res(s.m).winner;
      case 'lose':
        return res(s.m).loser;
      case 'grp': {
        const st = getStandings()[s.g];
        if (!st) return BYE;
        if (!st.complete) return null;
        return st.rows[s.r - 1]?.id ?? BYE;
      }
    }
  };

  function res(id: string): ResolvedMatch {
    if (byId[id]) return byId[id];
    const m = defs[id];
    const sideA = sideOf(m.a);
    const sideB = sideOf(m.b);
    const r = results[id];
    let status: ResolvedMatch['status'] = 'ready';
    let outcome: ResolvedMatch['outcome'] = null;
    if (sideA === null || sideB === null) status = 'waiting';
    else if (sideA === BYE || sideB === BYE) {
      status = 'bye';
      outcome = sideA === BYE ? 'b' : 'a';
    } else if (hasResult(r)) {
      status = 'done';
      outcome = outcomeOf(r);
    }
    const winner = outcome === 'a' ? sideA : outcome === 'b' ? sideB : null;
    const loser = outcome === 'a' ? sideB : outcome === 'b' ? sideA : null;
    byId[id] = { ...m, sideA, sideB, status, outcome, winner, loser, result: hasResult(r) ? r : undefined };
    return byId[id];
  }

  const matches = div.matches.map((m) => res(m.id));
  return { matches, byId, standings: getStandings() };
}

/** 조(리그) 순위표 */
export function computeStanding(
  group: number,
  members: ClassId[],
  ms: ResolvedMatch[],
  lp: LeaguePoints,
  manualOrder?: ClassId[],
): GroupStanding {
  const rows: Record<ClassId, StandingRow> = {};
  for (const id of members) rows[id] = { id, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, tied: false };
  for (const m of ms) {
    if (m.status !== 'done' || !m.result) continue;
    const A = rows[m.sideA as ClassId];
    const B = rows[m.sideB as ClassId];
    if (!A || !B) continue;
    A.played++;
    B.played++;
    if (!m.result.forfeit) {
      A.gf += m.result.a ?? 0;
      A.ga += m.result.b ?? 0;
      B.gf += m.result.b ?? 0;
      B.ga += m.result.a ?? 0;
    }
    if (m.outcome === 'draw') {
      A.d++;
      B.d++;
      A.pts += lp.draw;
      B.pts += lp.draw;
    } else {
      const [W, L] = m.outcome === 'a' ? [A, B] : [B, A];
      W.w++;
      L.l++;
      W.pts += lp.win;
      L.pts += lp.loss;
    }
  }
  const complete = ms.every((m) => m.status === 'done' || m.status === 'bye');
  const seed = (id: ClassId) => members.indexOf(id);

  // 상대 전적 승점(동률 학급끼리만 계산)
  const h2h = (ids: ClassId[]): Record<ClassId, number> => {
    const set = new Set(ids);
    const p: Record<ClassId, number> = Object.fromEntries(ids.map((i) => [i, 0]));
    for (const m of ms) {
      if (m.status !== 'done' || !set.has(m.sideA as string) || !set.has(m.sideB as string)) continue;
      if (m.outcome === 'draw') {
        p[m.sideA as string] += lp.draw;
        p[m.sideB as string] += lp.draw;
      } else {
        p[m.winner as string] += lp.win;
        p[m.loser as string] += lp.loss;
      }
    }
    return p;
  };

  const list = Object.values(rows);
  // 1차: 승점
  list.sort((x, y) => y.pts - x.pts || seed(x.id) - seed(y.id));
  // 같은 승점 묶음마다: 상대 전적 → 득실차 → 다득점 → (그래도 같으면 동률 표시)
  const out: StandingRow[] = [];
  for (let i = 0; i < list.length; ) {
    let j = i;
    while (j < list.length && list[j].pts === list[i].pts) j++;
    const tiedBlock = list.slice(i, j);
    if (tiedBlock.length > 1) {
      const hp = h2h(tiedBlock.map((r) => r.id));
      const key = (r: StandingRow) => [hp[r.id], r.gf - r.ga, r.gf];
      tiedBlock.sort((x, y) => {
        const kx = key(x);
        const ky = key(y);
        for (let k = 0; k < kx.length; k++) if (kx[k] !== ky[k]) return ky[k] - kx[k];
        return seed(x.id) - seed(y.id);
      });
      for (let k = 0; k < tiedBlock.length; k++) {
        const same = (o?: StandingRow) => !!o && JSON.stringify(key(o)) === JSON.stringify(key(tiedBlock[k]));
        if (same(tiedBlock[k - 1]) || same(tiedBlock[k + 1])) tiedBlock[k].tied = true;
      }
    }
    out.push(...tiedBlock);
    i = j;
  }

  // 수동 순위(추첨 결과)가 있고 같은 학급 구성이면 그대로 사용
  if (manualOrder && manualOrder.length === out.length && manualOrder.every((id) => rows[id])) {
    return { group, rows: manualOrder.map((id) => ({ ...rows[id], tied: false })), complete };
  }
  return { group, rows: out, complete };
}

// ---------------- 종목 최종 순위 ----------------

export interface FinalRank {
  id: ClassId;
  /** null = 아직 정해지지 않음. 같은 숫자 = 공동 순위 */
  rank: number | null;
}

/** 토너먼트에서 각 학급의 최종 순위 */
function knockoutRanks(div: Division, rd: ResolvedDivision): Map<ClassId, number | null> {
  const size = div.koSlots.length;
  const out = new Map<ClassId, number | null>();
  const ko = rd.matches.filter((m) => m.stage === 'ko');
  const third = rd.byId[`${div.key}-3rd`];
  const lastRound = Math.max(0, ...ko.map((m) => m.round));
  for (const m of ko) {
    for (const s of [m.sideA, m.sideB]) if (s && s !== BYE && !out.has(s)) out.set(s, null);
  }
  for (const m of ko) {
    if (m.status !== 'done' && m.status !== 'bye') continue;
    const loser = m.loser;
    if (loser && loser !== BYE) {
      // 4강 패자는 3·4위전이 있으면 그 경기에서 결정
      const rank = m.round === lastRound - 1 && third ? null : size / 2 ** m.round + 1;
      out.set(loser, rank);
    }
    if (m.round === lastRound && m.winner && m.winner !== BYE) out.set(m.winner, 1);
  }
  if (third && (third.status === 'done' || third.status === 'bye')) {
    if (third.winner && third.winner !== BYE) out.set(third.winner, 3);
    if (third.loser && third.loser !== BYE) out.set(third.loser, 4);
  }
  return out;
}

/** 순위제 기록 → 순위 */
export function rankByRecords(
  entrants: ClassId[],
  records: Record<ClassId, number | undefined>,
  rankBy: 'rank' | 'record_low' | 'record_high' = 'rank',
): FinalRank[] {
  const withRec = entrants.filter((c) => isNum(records[c]));
  const dir = rankBy === 'record_high' ? -1 : 1;
  const sorted = [...withRec].sort((x, y) => dir * ((records[x] as number) - (records[y] as number)));
  const rankOf = new Map<ClassId, number>();
  sorted.forEach((c, i) => {
    const prev = sorted[i - 1];
    rankOf.set(c, prev !== undefined && records[prev] === records[c] ? rankOf.get(prev)! : i + 1);
  });
  return entrants.map((id) => ({ id, rank: rankOf.get(id) ?? null }));
}

/**
 * 종목 최종 순위(대진 단위별). 관리자 화면 전용.
 * 공동 순위는 같은 숫자로 나온다(예: 8강 탈락 4학급 = 모두 5위).
 */
export function finalRanking(
  div: Division,
  rd: ResolvedDivision,
  records: Record<ClassId, number | undefined> = {},
  rankBy?: 'rank' | 'record_low' | 'record_high',
): FinalRank[] {
  const byRank = (list: FinalRank[]) =>
    [...list].sort((x, y) => (x.rank ?? 1e9) - (y.rank ?? 1e9) || div.entrants.indexOf(x.id) - div.entrants.indexOf(y.id));

  if (div.format === 'ranking') return byRank(rankByRecords(div.entrants, records, rankBy));

  if (div.format === 'round_robin') {
    const st = rd.standings[0];
    if (!st) return [];
    // 리그 순위: 완전히 같은 기록(동률 표시)끼리는 공동 순위
    const out: FinalRank[] = [];
    st.rows.forEach((r, i) => {
      const prev = st.rows[i - 1];
      const sameAsPrev = prev && r.tied && prev.tied && prev.pts === r.pts && prev.gf - prev.ga === r.gf - r.ga && prev.gf === r.gf;
      out.push({ id: r.id, rank: st.complete ? (sameAsPrev ? out[i - 1].rank : i + 1) : null });
    });
    return out;
  }

  const ko = knockoutRanks(div, rd);
  if (div.format === 'single_elim') return byRank(div.entrants.map((id) => ({ id, rank: ko.get(id) ?? null })));

  // 조별리그+토너먼트: 본선 진출 학급은 토너먼트 순위, 탈락 학급은 조 순위별 공동 순위
  const advance = Math.max(0, ...div.koSlots.map((s) => (s.t === 'grp' ? s.r : 0)));
  const koCount = div.koSlots.filter((s) => s.t === 'grp').length;
  const out: FinalRank[] = div.entrants.map((id) => {
    if (ko.has(id)) return { id, rank: ko.get(id) ?? null };
    for (const st of rd.standings) {
      const pos = st.rows.findIndex((r) => r.id === id);
      if (pos < 0) continue;
      if (!st.complete) return { id, rank: null };
      const r = pos + 1;
      if (r <= advance) return { id, rank: null }; // 진출했지만 본선 자리가 아직 없음
      return { id, rank: koCount + (r - advance - 1) * rd.standings.length + 1 };
    }
    return { id, rank: null };
  });
  return byRank(out);
}

// ---------------- 표시용 ----------------

export function slotText(s: Slot, labelOf: (m: string) => string): string {
  switch (s.t) {
    case 'class':
      return s.id;
    case 'bye':
      return '부전승';
    case 'win':
      return `${labelOf(s.m)} 승자`;
    case 'lose':
      return `${labelOf(s.m)} 패자`;
    case 'grp':
      return `${groupName(s.g)}조 ${s.r}위`;
  }
}

export function sameSlot(x: Slot, y: Slot): boolean {
  return JSON.stringify(x) === JSON.stringify(y);
}
