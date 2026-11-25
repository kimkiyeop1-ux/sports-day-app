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
