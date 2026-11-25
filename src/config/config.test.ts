import { describe, expect, it } from 'vitest';
import sample from '../../configs/sample-2026.json';
import { validateConfig } from './validate';
import { allClasses, toPublicInfo } from './derive';
import type { TournamentConfig } from './types';
import { computeProgress } from '../lib/scenario';

const cfg = sample as TournamentConfig;

describe('샘플 설정 파일', () => {
  it('검사 오류가 없다', () => {
    expect(validateConfig(cfg)).toEqual([]);
  });
  it('2학년 8학급이 만들어진다', () => {
    expect(allClasses(cfg)).toEqual(['2-1', '2-2', '2-3', '2-4', '2-5', '2-6', '2-7', '2-8']);
  });
  it('공개용 정보에는 배점·방송멘트가 들어가지 않는다', () => {
    const text = JSON.stringify(toPublicInfo(cfg));
    expect(text).not.toContain('byRank');
    expect(text).not.toContain('weight');
    expect(text).not.toContain('participation');
    expect(text).not.toContain('tieBreakers');
    expect(text).not.toContain('개회식을 시작하겠습니다');
  });
});

describe('설정 검사', () => {
  it('없는 학년을 쓰는 종목을 잡아낸다', () => {
    const bad = structuredClone(cfg);
    bad.events[0].grades = [3];
    expect(validateConfig(bad).join()).toContain('3학년');
  });
  it('잘못된 시각을 잡아낸다', () => {
    const bad = structuredClone(cfg);
    bad.scenario[0].time = '25:00';
    expect(validateConfig(bad).join()).toContain('HH:MM');
  });
});

describe('시나리오 진행 계산', () => {
  const at = (hm: string) => new Date(`2026-05-15T${hm}:00`).getTime();
  const items = [
    { id: 'a', time: '09:00', durationMin: 10 },
    { id: 'b', time: '09:10', durationMin: 20 },
    { id: 'c', time: '09:30', durationMin: 10 },
  ];
  it('완료 안 된 첫 항목이 현재, 그다음이 다음 순서', () => {
    const p = computeProgress(items, { a: at('09:12') }, at('09:13'));
    expect(p.current?.id).toBe('b');
    expect(p.next?.id).toBe('c');
    expect(p.delayMin).toBe(2); // a가 09:10 예정 → 09:12 완료
  });
  it('진행 중 항목이 계획보다 길어지면 지연이 늘어난다', () => {
    const p = computeProgress(items, { a: at('09:10') }, at('09:40'));
    expect(p.delayMin).toBe(10); // b 계획 종료 09:30, 지금 09:40
  });
  it('일찍 끝나면 음수(빠름)', () => {
    const p = computeProgress(items, { a: at('09:05') }, at('09:06'));
    expect(p.delayMin).toBe(-5);
  });
});
