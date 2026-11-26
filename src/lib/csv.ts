// CSV 만들기·내려받기. 엑셀에서 한글이 깨지지 않도록 맨 앞에 BOM을 붙인다.
export type Cell = string | number | null | undefined;

export function toCsv(rows: Cell[][]): string {
  const esc = (v: Cell) => {
    if (v == null) return '';
    const s = String(v);
    // 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싼다. 수식으로 해석될 수 있는 값(=,+,-,@로 시작하는 글자)은 앞에 '를 붙인다
    const safe = typeof v === 'string' && /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

export function download(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** 파일 이름에 붙일 시각 예: 20261126-1305 */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
