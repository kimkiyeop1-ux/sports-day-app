// npm run check-config -- <파일> 로 실행되는 설정 파일 검사
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { validateConfig } from './validate';

const file = process.env.CONFIG_FILE ?? 'configs/sample-2026.json';
it(`설정 파일 검사: ${file}`, () => {
  const errors = validateConfig(JSON.parse(readFileSync(file, 'utf8')));
  if (errors.length) console.error('\n문제 목록:\n- ' + errors.join('\n- '));
  expect(errors).toEqual([]);
});
