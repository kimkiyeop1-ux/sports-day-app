import { describe, expect, it } from 'vitest';
import sample from '../../configs/sample-2026.json';
import type { TournamentConfig } from '../config/types';
import { computeScores, eventScores, rankByScope, rankPoints, rankScores, tieBreakerOptions } from './scoring';
import type { FinalRank } from './bracket';

const cfg = sample as TournamentConfig;
const ev = (id: string) => cfg.events.find((e) => e.id === id)!;
const ranks = (list: [string, number | null][]): FinalRank[] => list.map(([id, rank]) => ({ id, rank }));

describe('순위 점수', () => {
  it('공동 순위: same = 그 순위 점수, average = 차지한 자리 평균', () => {
    const byRank = [100, 80, 60, 50, 40, 40, 30, 30];
    expect(rankPoints(byRank, 3, 2, 'same')).toBe(60);
    expect(rankPoints(byRank, 3, 2, 'average')).toBe(55);
    expect(rankPoints(byRank, 9, 1, 'same')).toBe(0); // 배점표보다 아래 순위 = 0점
  });
});

describe('종목 점수', () => {
  it('(순위 점수 + 참가점) × 가중치', () => {
    // 계주: byRank [100,85,...], 참가 10, 가중치 1.5
    const s = eventScores(ev('relay'), ranks([['2-1', 1], ['2-2', 2], ['2-3', null]]));
    expect(s['2-1']).toEqual({ rank: 1, points: 165 });
    expect(s['2-2']).toEqual({ rank: 2, points: 142.5 });
    expect(s['2-3']).toEqual({ rank: null, points: 0 });
  });
  it('8강 탈락 공동 5위 4학급은 평균 방식이면 5~8위 점수 평균', () => {
    const r = ranks([['2-1', 1], ['2-2', 2], ['2-3', 3], ['2-4', 4], ['2-5', 5], ['2-6', 5], ['2-7', 5], ['2-8', 5]]);
    // 피구 byRank [100,80,60,50,40,40,40,40], 참가 10
    expect(eventScores(ev('dodgeball'), r, 'same')['2-5'].points).toBe(50);
    expect(eventScores(ev('kickball'), r, 'average')['2-5'].points).toBe(10 + (40 + 40 + 30 + 30) / 4);
  });
  it('학년별 종목의 공동 순위 인원은 학년마다 따로 센다', () => {
    const e = { ...ev('kickball'), grades: [1, 2] };
    const r = ranks([['1-1', 3], ['1-2', 3], ['2-1', 3]]);
    const s = eventScores(e, r, 'average', (id) => `g${id[0]}`);
    expect(s['1-1'].points).toBe(10 + (60 + 50) / 2);
    expect(s['2-1'].points).toBe(10 + 60);
  });
});

describe('총점과 종합 순위', () => {
  const allRanks = {
    dodgeball: ranks([['2-1', 1], ['2-2', 2], ['2-3', 3], ['2-4', 4], ['2-5', 5], ['2-6', 5], ['2-7', 5], ['2-8', 5]]),
    kickball: ranks([['2-2', 1], ['2-1', 2], ['2-4', 3], ['2-3', 4], ['2-5', 5], ['2-6', 5], ['2-7', 7], ['2-8', 7]]),
  };

  it('경기 점수 + 경기 외 점수(감점은 뺌)', () => {
    const rows = computeScores(cfg, allRanks, { cheer: { '2-1': 20 }, penalty: { '2-1': 5 } });
    const r1 = rows.find((r) => r.id === '2-1')!;
    expect(r1.eventTotal).toBe(110 + 90);
    expect(r1.bonusTotal).toBe(15);
    expect(r1.total).toBe(215);
    expect(r1.events.jumprope).toEqual({ rank: null, points: 0 });
  });

  it('총점이 같으면 동점 규칙(1위 횟수)으로 가린다', () => {
    // 2-1: 피구 1위 110 + 발야구 2위 90 = 200 / 2-2: 피구 2위 90 + 발야구 1위 110 = 200 → 1위 횟수도 1:1
    const rows = computeScores(cfg, allRanks, {});
    const ranked = rankScores(rows, cfg, ['mostFirstPlaces']);
    expect(ranked.slice(0, 2).map((r) => [r.id, r.rank, r.shared])).toEqual([
      ['2-1', 1, true],
      ['2-2', 1, true],
    ]);
    expect(ranked[2].rank).toBe(3); // 공동 1위 다음은 3위
    // 피구 순위로 가리면 2-1이 앞
    const byDodge = rankScores(rows, cfg, ['mostFirstPlaces', 'event:dodgeball']);
    expect(byDodge.slice(0, 2).map((r) => [r.id, r.rank, r.shared, r.decidedBy])).toEqual([
      ['2-1', 1, false, 'event:dodgeball'],
      ['2-2', 2, false, 'event:dodgeball'],
    ]);
  });

  it('응원점수로 가리기, 감점 항목은 적을수록 앞', () => {
    const rows = computeScores(cfg, allRanks, { cheer: { '2-1': 10, '2-2': 10 }, penalty: { '2-1': 3, '2-2': 3 } });
    expect(rankScores(rows, cfg, ['bonus:cheer'])[0].shared).toBe(true);
    const rows2 = computeScores(cfg, allRanks, { order: { '2-2': 5 }, penalty: { '2-2': 5 } });
    // 2-2는 질서 +5, 감점 -5 → 총점은 같지만 감점이 많아서 뒤로
    const r = rankScores(rows2, cfg, ['bonus:penalty']);
    expect(r.slice(0, 2).map((x) => x.id)).toEqual(['2-1', '2-2']);
  });

  it('학년별 순위는 그 학년 학급끼리만', () => {
    const c2 = { ...cfg, grades: [{ grade: 1, classCount: 2 }, { grade: 2, classCount: 2 }], events: [{ ...ev('dodgeball'), grades: [1, 2] }] };
    const rows = computeScores(c2, { dodgeball: ranks([['1-1', 2], ['1-2', 1], ['2-1', 1], ['2-2', 2]]) }, {});
    expect(rankByScope(rows, c2, 1).map((r) => [r.id, r.rank])).toEqual([['1-2', 1], ['1-1', 2]]);
    expect(rankByScope(rows, c2, null).map((r) => r.rank)).toEqual([1, 1, 3, 3]);
  });

  it('동점 규칙 선택지에 종목·경기 외 점수 항목이 들어 있다', () => {
    const keys = tieBreakerOptions(cfg).map((o) => o.key);
    expect(keys).toContain('mostFirstPlaces');
    expect(keys).toContain('event:relay');
    expect(keys).toContain('bonus:cheer');
  });
});
