import { describe, expect, it, vi } from 'vitest';
vi.mock('./firebase', () => ({ db: {}, USE_EMULATOR: false }));
import { consoleUrl, parseProjectId } from './setupCheck';

describe('Firebase 프로젝트 이름 알아보기', () => {
  it('이름을 그대로 넣거나 콘솔 주소를 통째로 붙여넣어도 된다', () => {
    expect(parseProjectId('sports-day-urihakgyo')).toBe('sports-day-urihakgyo');
    expect(parseProjectId('  Sports-Day-Urihakgyo ')).toBe('sports-day-urihakgyo');
    expect(parseProjectId('https://console.firebase.google.com/project/sports-day-urihakgyo/overview')).toBe('sports-day-urihakgyo');
    expect(parseProjectId('console.firebase.google.com/project/abc-12345/settings/general')).toBe('abc-12345');
  });
  it('알아볼 수 없는 값은 null', () => {
    expect(parseProjectId('')).toBeNull();
    expect(parseProjectId('우리학교')).toBeNull();
    expect(parseProjectId('ab')).toBeNull();
  });
  it('고칠 곳마다 정확한 콘솔 화면 주소', () => {
    expect(consoleUrl.settings('p-1')).toBe('https://console.firebase.google.com/project/p-1/settings/general');
    expect(consoleUrl.providers('p-1')).toContain('/authentication/providers');
  });
});
