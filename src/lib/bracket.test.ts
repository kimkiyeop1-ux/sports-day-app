import { describe, expect, it } from 'vitest';
import sample from '../../configs/sample-2026.json';
import type { EventConfig, TournamentConfig } from '../config/types';
import {
  BYE,
  buildMatches,
  checkResult,
  createDivision,
  createEventBracket,
  finalRanking,
  makeHeats,
  outcomeOf,
  rankByRecords,
  resolveDivision,
  roundRobinPairs,
  seedOrder,
  seededSlots,
  snakeGroups,
  type Division,
  type Results,
} from './bracket';

const cfg = sample as TournamentConfig;
const LP = { win: 3, draw: 1, loss: 0 };
const classes = (n: number, g = 2) => Array.from({ length: n }, (_, i) => `${g}-${i + 1}`);
const ev = (patch: Partial<EventConfig>): EventConfig => ({
  id: 'e',
  name: '종목',
  scope: 'grade',
  grades: [2],
  format: { type: 'single_elim' },
  match: { mode: 'score' },
  points: { byRank: [], participation: 0, leagueWin: 3, leagueDraw: 1, leagueLoss: 0, weight: 1 },
  ...patch,
});
/** A가 이기는 결과 */
const winA = { a: 1, b: 0 };
const winB = { a: 0, b: 1 };

describe('시드 배치', () => {
  it('표준 시드 순서', () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
  it('학급 수가 모자라면 높은 시드가 부전승을 받는다', () => {
    const s = seededSlots(classes(6).map((id) => ({ t: 'class' as const, id })));
    expect(s).toHaveLength(8);
    // 1번 시드(2-1)의 상대 = 8번 시드 자리 = 부전승
    expect(s[0]).toEqual({ t: 'class', id: '2-1' });
    expect(s[1]).toEqual({ t: 'bye' });
    expect(s.filter((x) => x.t === 'bye')).toHaveLength(2);
  });
});

describe('리그 대진', () => {
  it.each([2, 3, 4, 5, 8])('%i팀이면 모두 한 번씩 만난다', (n) => {
    const pairs = roundRobinPairs(n);
    expect(pairs).toHaveLength((n * (n - 1)) / 2);
    const keys = new Set(pairs.map(([, i, j]) => `${i}-${j}`));
    expect(keys.size).toBe(pairs.length);
  });
  it('한 차수에 같은 팀이 두 번 나오지 않는다', () => {
    const pairs = roundRobinPairs(6);
    for (let r = 1; r <= 5; r++) {
      const teams = pairs.filter((p) => p[0] === r).flatMap((p) => [p[1], p[2]]);
      expect(new Set(teams).size).toBe(teams.length);
    }
  });
  it('조 편성은 지그재그로 고르게 나눈다', () => {
    expect(snakeGroups(classes(8), 2)).toEqual([
      ['2-1', '2-4', '2-5', '2-8'],
      ['2-2', '2-3', '2-6', '2-7'],
    ]);
    expect(snakeGroups(classes(7), 3).map((g) => g.length)).toEqual([3, 2, 2]);
  });
});

describe('싱글 토너먼트', () => {
  const E = ev({ format: { type: 'single_elim', thirdPlaceMatch: true }, match: { mode: 'sets', setsToWin: 2 } });

  it('8학급: 8강 4 + 4강 2 + 결승 1 + 3·4위전 1', () => {
    const d = createDivision(E, 'g2', '2학년', classes(8));
    expect(d.matches.map((m) => m.label).sort()).toEqual(
      ['8강 1경기', '8강 2경기', '8강 3경기', '8강 4경기', '4강 1경기', '4강 2경기', '3·4위전', '결승'].sort(),
    );
  });

  it('승자가 다음 경기로 올라가고 최종 순위가 나온다', () => {
    const d = createDivision(E, 'g2', '2학년', classes(8));
    const r: Results = {};
    // 8강: 모두 위쪽(a) 승 → 시드 1,4,2,3 진출
    for (let k = 1; k <= 4; k++) r[`g2-R1-${k}`] = { a: 2, b: 1 };
    let rd = resolveDivision(d, r, LP);
    expect(rd.byId['g2-R2-1'].sideA).toBe('2-1');
    expect(rd.byId['g2-R2-1'].sideB).toBe('2-4');
    expect(rd.byId['g2-R3-1'].status).toBe('waiting');
    r['g2-R2-1'] = { a: 2, b: 0 }; // 2-1 승
    r['g2-R2-2'] = { a: 1, b: 2 }; // 2-3 승 (2-2 vs 2-3)
    r['g2-3rd'] = { a: 2, b: 1 }; // 2-4 3위
    r['g2-R3-1'] = { a: 0, b: 2 }; // 2-3 우승
    rd = resolveDivision(d, r, LP);
    expect(rd.byId['g2-3rd'].sideA).toBe('2-4');
    expect(rd.byId['g2-3rd'].sideB).toBe('2-2');
    const fr = finalRanking(d, rd);
    expect(fr.slice(0, 4)).toEqual([
      { id: '2-3', rank: 1 },
      { id: '2-1', rank: 2 },
      { id: '2-4', rank: 3 },
      { id: '2-2', rank: 4 },
    ]);
    expect(fr.slice(4).every((x) => x.rank === 5)).toBe(true);
  });

  it('6학급: 부전승은 자동으로 다음 라운드 진출', () => {
    const d = createDivision(E, 'g2', '2학년', classes(6));
    const rd = resolveDivision(d, {}, LP);
    const byes = rd.matches.filter((m) => m.status === 'bye');
    expect(byes).toHaveLength(2);
    expect(rd.byId['g2-R2-1'].sideA).toBe('2-1'); // 1번 시드가 부전승으로 4강
    expect(rd.byId['g2-R2-1'].sideB).toBeNull(); // 4·5번 시드 경기 결과 대기
  });

  it('3학급: 부전승 + 3·4위전 상대가 없으면 자동 3위', () => {
    const d = createDivision(E, 'g2', '2학년', classes(3));
    const r: Results = { 'g2-R1-2': { a: 2, b: 0 }, 'g2-R2-1': { a: 2, b: 1 } };
    const rd = resolveDivision(d, r, LP);
    expect(rd.byId['g2-3rd'].status).toBe('bye');
    const fr = finalRanking(d, rd);
    expect(fr).toEqual([
      { id: '2-1', rank: 1 },
      { id: '2-2', rank: 2 },
      { id: '2-3', rank: 3 },
    ]);
  });

  it('기권하면 상대가 이긴다', () => {
    const d = createDivision(E, 'g2', '2학년', classes(2));
    const rd = resolveDivision(d, { 'g2-R1-1': { forfeit: 'a' } }, LP);
    expect(rd.byId['g2-R1-1'].winner).toBe('2-2');
  });

  it('재경기(점수 지움)하면 다시 경기 전 상태가 된다', () => {
    const d = createDivision(E, 'g2', '2학년', classes(2));
    const rd = resolveDivision(d, { 'g2-R1-1': { replays: 1 } }, LP);
    expect(rd.byId['g2-R1-1'].status).toBe('ready');
    expect(rd.byId['g2-R1-1'].winner).toBeNull();
  });

  it('수동으로 자리를 바꾸면 대진이 바뀐다(추첨 결과 입력)', () => {
    const d = createDivision(E, 'g2', '2학년', classes(4));
    const koSlots = [...d.koSlots];
    [koSlots[1], koSlots[2]] = [koSlots[2], koSlots[1]];
    const d2: Division = { ...d, koSlots, matches: buildMatches({ ...d, koSlots }) };
    const rd = resolveDivision(d2, {}, LP);
    expect([rd.byId['g2-R1-1'].sideA, rd.byId['g2-R1-1'].sideB]).toEqual(['2-1', '2-2']);
  });
});

describe('결과 검사', () => {
  it('세트제: 3판 2선승은 한쪽이 정확히 2세트', () => {
    const rule = { mode: 'sets' as const, setsToWin: 2 };
    expect(checkResult(rule, { a: 2, b: 1 }, false)).toBeNull();
    expect(checkResult(rule, { a: 2, b: 0 }, false)).toBeNull();
    expect(checkResult(rule, { a: 1, b: 1 }, false)).not.toBeNull();
    expect(checkResult(rule, { a: 3, b: 0 }, false)).not.toBeNull();
    expect(checkResult(rule, { a: 2, b: 1, sets: [[21, 15], [10, 21], [21, 19]] }, false)).toBeNull();
    expect(checkResult(rule, { a: 2, b: 0, sets: [[21, 15], [10, 21]] }, false)).not.toBeNull();
  });
  it('점수제: 토너먼트 동점은 승부차기 등으로 승자를 골라야 한다', () => {
    const rule = { mode: 'score' as const, allowDraw: true };
    expect(checkResult(rule, { a: 3, b: 3 }, false)).not.toBeNull();
    expect(checkResult(rule, { a: 3, b: 3, tbWinner: 'b' }, false)).toBeNull();
    expect(outcomeOf({ a: 3, b: 3, tbWinner: 'b' })).toBe('b');
    expect(checkResult(rule, { a: 3, b: 3 }, true)).toBeNull();
    expect(outcomeOf({ a: 3, b: 3 })).toBe('draw');
  });
  it('점수 빠짐·음수는 오류', () => {
    const rule = { mode: 'score' as const };
    expect(checkResult(rule, { a: 1 }, false)).not.toBeNull();
    expect(checkResult(rule, { a: -1, b: 0 }, false)).not.toBeNull();
    expect(checkResult(rule, { forfeit: 'b' }, false)).toBeNull();
  });
});

describe('리그(풀리그)', () => {
  const E = ev({ format: { type: 'round_robin' }, match: { mode: 'score', allowDraw: true } });

  it('승점 → 상대전적 → 득실차 순으로 순위', () => {
    const d = createDivision(E, 'g2', '2학년', classes(3));
    // 경기 목록에서 학급 쌍으로 결과를 넣는 도우미
    const r: Results = {};
    const put = (x: string, y: string, sx: number, sy: number) => {
      const m = d.matches.find((m) => m.a.t === 'class' && m.b.t === 'class' && [m.a.id, m.b.id].sort().join() === [x, y].sort().join())!;
      r[m.id] = (m.a as any).id === x ? { a: sx, b: sy } : { a: sy, b: sx };
    };
    put('2-1', '2-2', 1, 1); // 무
    put('2-1', '2-3', 3, 0); // 2-1 승
    put('2-2', '2-3', 1, 0); // 2-2 승
    const rd = resolveDivision(d, r, LP);
    const st = rd.standings[0];
    expect(st.complete).toBe(true);
    // 2-1, 2-2 모두 4점, 상대전적 무 → 득실차 2-1(+3) > 2-2(+1)
    expect(st.rows.map((x) => [x.id, x.pts])).toEqual([
      ['2-1', 4],
      ['2-2', 4],
      ['2-3', 0],
    ]);
    expect(finalRanking(d, rd).map((x) => x.rank)).toEqual([1, 2, 3]);
  });

  it('모든 기준이 같으면 동률 표시 → 수동 순위(추첨)로 정할 수 있다', () => {
    const d = createDivision(E, 'g2', '2학년', classes(2));
    const r: Results = { [d.matches[0].id]: { a: 1, b: 1 } };
    let rd = resolveDivision(d, r, LP);
    expect(rd.standings[0].rows.every((x) => x.tied)).toBe(true);
    expect(finalRanking(d, rd).map((x) => x.rank)).toEqual([1, 1]);
    rd = resolveDivision(d, r, LP, { '0': ['2-2', '2-1'] });
    expect(rd.standings[0].rows.map((x) => x.id)).toEqual(['2-2', '2-1']);
    expect(finalRanking(d, rd).map((x) => x.rank)).toEqual([1, 2]);
  });

  it('경기가 남아 있으면 순위 미정', () => {
    const d = createDivision(E, 'g2', '2학년', classes(4));
    const rd = resolveDivision(d, {}, LP);
    expect(rd.standings[0].complete).toBe(false);
    expect(finalRanking(d, rd).every((x) => x.rank === null)).toBe(true);
  });
});

describe('조별리그 + 토너먼트 (샘플 발야구: 8학급, 2개 조, 조 2위까지 진출, 3·4위전)', () => {
  const kick = cfg.events.find((e) => e.id === 'kickball')!;

  it('조마다 리그 6경기 + 4강 2 + 3·4위전 + 결승', () => {
    const [d] = createEventBracket(kick, cfg, false);
    expect(d.groups.map((g) => g.length)).toEqual([4, 4]);
    expect(d.matches.filter((m) => m.stage === 'group')).toHaveLength(12);
    expect(d.matches.filter((m) => m.stage !== 'group')).toHaveLength(4);
    // A1 vs B2, B1 vs A2
    expect(d.koSlots).toEqual([
      { t: 'grp', g: 0, r: 1 },
      { t: 'grp', g: 1, r: 2 },
      { t: 'grp', g: 1, r: 1 },
      { t: 'grp', g: 0, r: 2 },
    ]);
  });

  it('조별리그가 끝나야 본선 대진이 채워지고, 최종 순위가 나온다', () => {
    const [d] = createEventBracket(kick, cfg, false);
    const r: Results = {};
    // 각 조: 조 안에서 앞쪽(시드 높은) 학급이 항상 이김
    for (const m of d.matches.filter((m) => m.stage === 'group')) {
      const g = d.groups[m.group!];
      const ia = g.indexOf((m.a as any).id);
      const ib = g.indexOf((m.b as any).id);
      r[m.id] = ia < ib ? winA : winB;
    }
    const lastGroupMatch = d.matches.filter((m) => m.stage === 'group').at(-1)!.id;
    const partial = { ...r };
    delete partial[lastGroupMatch];
    expect(resolveDivision(d, partial, LP).byId['g2-R1-2'].sideA).toBeNull();

    let rd = resolveDivision(d, r, LP);
    // A조: 2-1,2-4,2-5,2-8 → 1위 2-1, 2위 2-4 / B조: 2-2,2-3,2-6,2-7 → 1위 2-2, 2위 2-3
    expect([rd.byId['g2-R1-1'].sideA, rd.byId['g2-R1-1'].sideB]).toEqual(['2-1', '2-3']);
    expect([rd.byId['g2-R1-2'].sideA, rd.byId['g2-R1-2'].sideB]).toEqual(['2-2', '2-4']);
    r['g2-R1-1'] = winA;
    r['g2-R1-2'] = winB; // 2-4 승
    r['g2-3rd'] = winA; // 2-3 vs 2-2 → 2-3 3위
    r['g2-R2-1'] = winA; // 2-1 우승
    rd = resolveDivision(d, r, LP);
    const fr = finalRanking(d, rd);
    expect(fr.map((x) => `${x.id}:${x.rank}`)).toEqual(['2-1:1', '2-4:2', '2-3:3', '2-2:4', '2-5:5', '2-6:5', '2-7:7', '2-8:7']);
  });
});

describe('순위제', () => {
  it('조 나누기는 고르게', () => {
    expect(makeHeats(classes(8), 4).map((h) => h.length)).toEqual([4, 4]);
    expect(makeHeats(classes(9), 4).map((h) => h.length)).toEqual([3, 3, 3]);
    expect(makeHeats(classes(5), 0)).toHaveLength(1);
  });
  it('기록 → 순위 (낮을수록/높을수록), 같은 기록은 공동 순위', () => {
    const rec = { '2-1': 52.3, '2-2': 50.1, '2-3': 52.3 };
    expect(rankByRecords(classes(4), rec, 'record_low')).toEqual([
      { id: '2-1', rank: 2 },
      { id: '2-2', rank: 1 },
      { id: '2-3', rank: 2 },
      { id: '2-4', rank: null },
    ]);
    expect(rankByRecords(classes(3), { '2-1': 10, '2-2': 30, '2-3': 20 }, 'record_high').map((x) => x.rank)).toEqual([3, 1, 2]);
    expect(rankByRecords(classes(2), { '2-1': 2, '2-2': 1 }, 'rank').map((x) => x.rank)).toEqual([2, 1]);
  });
  it('샘플 계주: 4학급씩 2개 조, 경기(대결)는 없음', () => {
    const relay = cfg.events.find((e) => e.id === 'relay')!;
    const [d] = createEventBracket(relay, cfg, false);
    expect(d.heats).toHaveLength(2);
    expect(d.matches).toHaveLength(0);
  });
});

describe('대진 단위·추첨', () => {
  it('학년별 종목은 학년마다, 전교 종목은 하나로 만든다', () => {
    const c = { grades: [{ grade: 1, classCount: 3 }, { grade: 2, classCount: 4 }] };
    expect(createEventBracket(ev({ grades: [1, 2] }), c, false).map((d) => [d.key, d.entrants.length])).toEqual([
      ['g1', 3],
      ['g2', 4],
    ]);
    const all = createEventBracket(ev({ scope: 'school', grades: [1, 2] }), c, false);
    expect(all.map((d) => [d.key, d.entrants.length])).toEqual([['all', 7]]);
  });
  it('무작위 추첨도 모든 학급이 한 번씩 들어간다', () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const [d] = createEventBracket(ev({}), { grades: [{ grade: 2, classCount: 7 }] }, true, rng);
    const ids = d.koSlots.filter((s) => s.t === 'class').map((s) => (s as any).id).sort();
    expect(ids).toEqual(classes(7).sort());
    expect(d.koSlots.filter((s) => s.t === 'bye')).toHaveLength(1);
  });
  it('양쪽 다 빈 자리면 빈 자리가 올라간다(오류 없음)', () => {
    const d = createDivision(ev({}), 'g2', '2학년', classes(1));
    const rd = resolveDivision(d, {}, LP);
    expect(rd.matches[0].winner).toBe('2-1');
    expect(BYE).toBeTruthy();
  });
});
