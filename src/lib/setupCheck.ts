// =============================================================
// 학교 연결 자동 점검: Firebase에서 빠진 설정을 앱이 직접 확인한다.
// (선생님이 Firebase 메뉴 이름을 몰라도, 빠진 것만 버튼 하나로 열 수 있게)
// =============================================================
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import { db, USE_EMULATOR } from './firebase';
import { RULES_VERSION } from './rulesVersion';
import type { Connection } from './connection';

/** ok = 됨 / missing = 안 됨(고쳐야 함) / unknown = 자동 확인 불가(직접 확인) */
export type CheckState = 'ok' | 'missing' | 'unknown';

export interface SetupStatus {
  database: CheckState;
  rules: CheckState;
  anonymous: CheckState;
  /** Authentication을 아예 시작하지 않음 */
  authNotStarted: boolean;
  google: CheckState;
  domain: CheckState;
  offline: boolean;
  detail?: string;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej({ code: 'timeout' }), ms))]);
}

/** 데이터베이스 + 보안 규칙 */
async function checkFirestore(): Promise<{ database: CheckState; rules: CheckState; detail?: string }> {
  try {
    await withTimeout(getDocFromServer(doc(db, `meta/rulesCheck_v${RULES_VERSION}`)), 12000);
    return { database: 'ok', rules: 'ok' };
  } catch (e: any) {
    const msg = String(e?.message ?? '');
    const code = String(e?.code ?? '');
    // 데이터베이스를 아직 만들지 않음(또는 Firestore가 꺼져 있음)
    if (code === 'not-found' || code === 'failed-precondition' || /does not exist|has not been used|is disabled|not found/i.test(msg))
      return { database: 'missing', rules: 'unknown', detail: code };
    // 데이터베이스는 있는데 최신 규칙이 아님
    if (code === 'permission-denied') return { database: 'ok', rules: 'missing' };
    return { database: 'unknown', rules: 'unknown', detail: code || msg };
  }
}

/** 익명 로그인(심판·진행자 기기). 별도 임시 앱으로 시험해 지금 로그인 상태를 건드리지 않는다 */
async function checkAnonymous(c: Connection): Promise<{ anonymous: CheckState; authNotStarted: boolean }> {
  const app = initializeApp(c, `probe-${Date.now()}`);
  try {
    const a = getAuth(app);
    if (USE_EMULATOR) connectAuthEmulator(a, `http://${location.hostname}:9099`, { disableWarnings: true });
    const cred = await withTimeout(signInAnonymously(a), 12000);
    await cred.user.delete().catch(() => {}); // 시험용 계정은 바로 지운다
    return { anonymous: 'ok', authNotStarted: false };
  } catch (e: any) {
    const code = String(e?.code ?? '');
    if (code === 'auth/configuration-not-found') return { anonymous: 'missing', authNotStarted: true };
    if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') return { anonymous: 'missing', authNotStarted: false };
    return { anonymous: 'unknown', authNotStarted: false };
  } finally {
    deleteApp(app).catch(() => {});
  }
}

/** Google 로그인 켜짐 + 이 사이트 주소(도메인) 허용 여부 */
async function checkGoogle(c: Connection): Promise<{ google: CheckState; domain: CheckState }> {
  if (USE_EMULATOR) return { google: 'ok', domain: 'ok' };
  const base = 'https://identitytoolkit.googleapis.com/v1';
  let domain: CheckState = 'unknown';
  let google: CheckState = 'unknown';
  try {
    const r = await withTimeout(fetch(`${base}/projects?key=${encodeURIComponent(c.apiKey)}`), 10000);
    const j = await r.json();
    if (Array.isArray(j.authorizedDomains)) domain = j.authorizedDomains.includes(location.hostname) ? 'ok' : 'missing';
    else if (/CONFIGURATION_NOT_FOUND/.test(JSON.stringify(j))) return { google: 'missing', domain: 'missing' };
  } catch {
    /* 확인 불가 */
  }
  try {
    const r = await withTimeout(
      fetch(`${base}/accounts:createAuthUri?key=${encodeURIComponent(c.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'google.com', continueUri: location.origin + location.pathname }),
      }),
      10000,
    );
    const j = await r.json();
    if (j.authUri) google = 'ok';
    else if (/OPERATION_NOT_ALLOWED|CONFIGURATION_NOT_FOUND|INVALID_PROVIDER_ID/.test(JSON.stringify(j))) google = 'missing';
  } catch {
    /* 확인 불가 */
  }
  return { google, domain };
}

export async function checkSetup(c: Connection): Promise<SetupStatus> {
  if (!navigator.onLine)
    return { database: 'unknown', rules: 'unknown', anonymous: 'unknown', authNotStarted: false, google: 'unknown', domain: 'unknown', offline: true };
  const [fs, an, gg] = await Promise.all([checkFirestore(), checkAnonymous(c), checkGoogle(c)]);
  return { ...fs, ...an, ...gg, offline: false };
}

/** 주소창 주소(콘솔 URL)나 프로젝트 ID 입력에서 프로젝트 ID만 뽑기 */
export function parseProjectId(text: string): string | null {
  const t = text.trim();
  const m = t.match(/project\/([a-z0-9-]+)/i);
  if (m) return m[1].toLowerCase();
  if (/^[a-z][a-z0-9-]{4,29}$/i.test(t)) return t.toLowerCase();
  return null;
}

/** Firebase 콘솔의 정확한 화면 주소 */
export const consoleUrl = {
  home: 'https://console.firebase.google.com/',
  settings: (p: string) => `https://console.firebase.google.com/project/${p}/settings/general`,
  firestore: (p: string) => `https://console.firebase.google.com/project/${p}/firestore`,
  rules: (p: string) => `https://console.firebase.google.com/project/${p}/firestore/rules`,
  providers: (p: string) => `https://console.firebase.google.com/project/${p}/authentication/providers`,
  domains: (p: string) => `https://console.firebase.google.com/project/${p}/authentication/settings`,
};
