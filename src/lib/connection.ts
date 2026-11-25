// =============================================================
// 학교 연결(Firebase 연결값) 관리
//
// 각 학교는 자기 Firebase 프로젝트를 만들고, 앱의 [학교 연결] 화면에
// 연결값(firebaseConfig)을 붙여넣는다. 값은 이 기기의 브라우저에 저장된다.
// 전광판·심판용 링크에는 연결값이 ?s=... 로 들어 있어, 링크만 열면 자동 연결된다.
// (연결값은 비밀이 아닌 '주소'이며, 데이터 보호는 각 학교의 보안 규칙이 담당한다.)
// =============================================================
import { firebaseConfig as builtIn } from '../firebase-config';

export interface Connection {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

const KEY = 'sportsday.connection';

/** 붙여넣은 글(firebaseConfig 코드 조각 또는 JSON)에서 연결값을 뽑아낸다 */
export function parseConnectionText(text: string): Connection | null {
  const pick = (k: string) => {
    const m = new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`).exec(text);
    return m?.[1]?.trim() ?? '';
  };
  const apiKey = pick('apiKey');
  const projectId = pick('projectId');
  const appId = pick('appId');
  const authDomain = pick('authDomain') || (projectId ? `${projectId}.firebaseapp.com` : '');
  if (!apiKey || !projectId || !appId) return null;
  return { apiKey, authDomain, projectId, appId };
}

function b64urlEncode(s: string) {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string) {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(p + '==='.slice((p.length + 3) % 4));
}

/** 공유 링크용 짧은 문자열 */
export function encodeConnection(c: Connection): string {
  return b64urlEncode(JSON.stringify([c.apiKey, c.authDomain, c.projectId, c.appId]));
}

export function decodeConnection(s: string): Connection | null {
  try {
    const [apiKey, authDomain, projectId, appId] = JSON.parse(b64urlDecode(s));
    if (typeof apiKey !== 'string' || typeof projectId !== 'string' || typeof appId !== 'string') return null;
    return { apiKey, authDomain: authDomain || `${projectId}.firebaseapp.com`, projectId, appId };
  } catch {
    return null;
  }
}

function readStored(): Connection | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Connection) : null;
  } catch {
    return null;
  }
}

export function saveConnection(c: Connection | null) {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    /* 저장 불가(사생활 보호 모드 등) — 링크의 ?s= 로만 동작 */
  }
}

/**
 * 앱 시작 시 사용할 연결값 결정 (우선순위)
 * 1) 주소의 ?s=  (전광판·심판 링크) → 이 기기에 저장
 * 2) 이 기기에 저장된 값 ([학교 연결] 화면에서 저장)
 * 3) 코드에 직접 넣은 값(src/firebase-config.ts, 저장소를 복사해 쓰는 학교용)
 */
export function resolveConnection(): Connection | null {
  const fromUrl = new URLSearchParams(location.search).get('s');
  if (fromUrl) {
    const c = decodeConnection(fromUrl);
    if (c) {
      saveConnection(c);
      return c;
    }
  }
  const stored = readStored();
  if (stored) return stored;
  if (!builtIn.projectId.startsWith('REPLACE')) {
    return { apiKey: builtIn.apiKey, authDomain: builtIn.authDomain, projectId: builtIn.projectId, appId: builtIn.appId };
  }
  return null;
}

/** 이 학교에 연결되는 링크 만들기. 예: shareLink(c, '/board') */
export function shareLink(c: Connection, hashPath: string): string {
  const base = location.origin + location.pathname;
  return `${base}?s=${encodeConnection(c)}#${hashPath}`;
}
