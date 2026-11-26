import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('CSV', () => {
  it('엑셀용 BOM, 쉼표·따옴표·줄바꿈 처리', () => {
    const s = toCsv([
      ['학급', '메모', '점수'],
      ['2-1', '비, 우천', 10],
      ['2-2', '"좋음"', -5],
      ['2-3', '줄\n바꿈', null],
    ]);
    expect(s.startsWith('﻿')).toBe(true);
    expect(s.slice(1).split('\r\n')).toEqual(['학급,메모,점수', '2-1,"비, 우천",10', '2-2,"""좋음""",-5', '2-3,"줄\n바꿈",']);
  });
  it('수식처럼 보이는 글자는 그대로 실행되지 않게 막는다(숫자는 그대로)', () => {
    expect(toCsv([['=1+1', '-3', '-감점']]).slice(1)).toBe("'=1+1,-3,'-감점");
  });
});
