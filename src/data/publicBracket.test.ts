import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/firebase', () => ({ db: {}, auth: {} }));
import sample from '../../configs/sample-2026.json';
import type { TournamentConfig } from '../config/types';
import { createEventBracket } from '../lib/bracket';
import { emptyBracket, toPublicBracket } from './store';

const cfg = sample as TournamentConfig;

describe('공개용 대진표', () => {
  it('배점·가중치·관리자 메모가 들어가지 않는다', () => {
    for (const ev of cfg.events) {
      const data = { ...emptyBracket(ev.id), divisions: createEventBracket(ev, cfg, true) };
      data.results = { x: { a: 1, b: 0, note: '비밀메모' } };
      const text = JSON.stringify(toPublicBracket(ev, data));
      expect(text).not.toContain('byRank');
      expect(text).not.toContain('weight');
      expect(text).not.toContain('participation');
      expect(text).not.toContain('비밀메모');
      expect(text).toContain('"a":1');
    }
  });
});

describe('경기 결과 읽기(3단계 형식)', () => {
  it('결과 문서 값이 2단계 형식(대진표 문서 안) 값보다 우선하고, "{}"는 지운 결과', async () => {
    const { readResults } = await import('./store');
    const legacy = { results: { m1: { a: 1, b: 0 }, m2: { a: 2, b: 2 } }, records: { g2: { '2-1': 10 } } };
    const out = readResults({ r: { m1: '{}', m3: '{"a":5,"b":4}' }, rec: { g2: { '2-1': 12 } } }, legacy);
    expect(out.results).toEqual({ m1: {}, m2: { a: 2, b: 2 }, m3: { a: 5, b: 4 } });
    expect(out.records).toEqual({ g2: { '2-1': 12 } });
  });
  it('결과 문서가 없어도 동작한다', async () => {
    const { readResults } = await import('./store');
    expect(readResults(null, null)).toEqual({ results: {}, records: {} });
  });
});
