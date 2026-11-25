import { describe, expect, it } from 'vitest';
import { decodeConnection, encodeConnection, parseConnectionText } from './connection';

const snippet = `// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
const firebaseConfig = {
  apiKey: "AIzaSyD-abc_123",
  authDomain: "sports-day-school.firebaseapp.com",
  projectId: "sports-day-school",
  storageBucket: "sports-day-school.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456"
};
const app = initializeApp(firebaseConfig);`;

describe('학교 연결값', () => {
  it('Firebase 콘솔에서 복사한 코드 조각을 그대로 읽는다', () => {
    expect(parseConnectionText(snippet)).toEqual({
      apiKey: 'AIzaSyD-abc_123',
      authDomain: 'sports-day-school.firebaseapp.com',
      projectId: 'sports-day-school',
      appId: '1:1234567890:web:abcdef123456',
    });
  });
  it('JSON 형식도 읽는다', () => {
    const c = parseConnectionText('{"apiKey":"k","projectId":"p","appId":"a"}');
    expect(c?.authDomain).toBe('p.firebaseapp.com');
  });
  it('필수 값이 없으면 null', () => {
    expect(parseConnectionText('apiKey: "k"')).toBeNull();
  });
  it('공유 링크 문자열로 바꿨다가 되돌릴 수 있다', () => {
    const c = parseConnectionText(snippet)!;
    const s = encodeConnection(c);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeConnection(s)).toEqual(c);
  });
  it('망가진 링크 문자열은 무시한다', () => {
    expect(decodeConnection('!!!')).toBeNull();
  });
});
