// =============================================================
// 보안 규칙 자동 테스트 (npm run test:rules)
// Firebase 에뮬레이터 위에서 "누가 무엇을 읽고 쓸 수 있는지"를 실제로 시도해 증명한다.
// =============================================================
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

const T = 'tournaments/2026-sample';
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-sportsday',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  // 규칙을 끈 상태로 기초 데이터 준비
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'meta/admins'), { uids: ['admin'] });
    await setDoc(doc(db, 'meta/active'), { tournamentId: '2026-sample' });
    await setDoc(doc(db, `${T}/private/config`), { config: { scoring: { secret: true } } });
    await setDoc(doc(db, `${T}/private/scenario`), { done: {} });
    await setDoc(doc(db, `${T}/public/info`), { title: '샘플' });
    await setDoc(doc(db, `${T}/audit/a1`), { actor: 'admin', action: 'x' });
  });
});

const anon = () => env.unauthenticatedContext().firestore();
const stranger = () => env.authenticatedContext('stranger').firestore();
const admin = () => env.authenticatedContext('admin').firestore();

describe('비로그인 사용자(전광판·학생)', () => {
  it('공개 문서는 읽을 수 있다', async () => {
    await assertSucceeds(getDoc(doc(anon(), `${T}/public/info`)));
    await assertSucceeds(getDoc(doc(anon(), 'meta/active')));
  });
  it('관리자용 설정(배점)을 읽을 수 없다', async () => {
    await assertFails(getDoc(doc(anon(), `${T}/private/config`)));
  });
  it('관리자용 문서 목록 전체를 읽을 수 없다', async () => {
    await assertFails(getDocs(collection(anon(), `${T}/private`)));
  });
  it('변경 이력을 읽을 수 없다', async () => {
    await assertFails(getDoc(doc(anon(), `${T}/audit/a1`)));
  });
  it('관리자 목록을 읽을 수 없다', async () => {
    await assertFails(getDoc(doc(anon(), 'meta/admins')));
  });
  it('공개 문서를 고칠 수 없다', async () => {
    await assertFails(setDoc(doc(anon(), `${T}/public/info`), { title: '해킹' }));
  });
  it('정의되지 않은 경로는 읽을 수 없다', async () => {
    await assertFails(getDoc(doc(anon(), 'anything/else')));
  });
});

describe('로그인했지만 관리자가 아닌 사용자', () => {
  it('관리자용 설정을 읽을 수 없다', async () => {
    await assertFails(getDoc(doc(stranger(), `${T}/private/config`)));
  });
  it('자기 자신을 관리자로 등록할 수 없다', async () => {
    await assertFails(setDoc(doc(stranger(), 'meta/admins'), { uids: ['stranger'] }));
  });
  it('공개 문서를 고칠 수 없다', async () => {
    await assertFails(setDoc(doc(stranger(), `${T}/public/info`), { title: '해킹' }));
  });
});

describe('최초 관리자 등록', () => {
  const google = (uid: string) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'google.com' } } as any).firestore();
  const anonUser = (uid: string) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } } as any).firestore();
  beforeEach(async () => {
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), 'meta/admins')));
  });
  it('관리자가 아직 없으면 Google 로그인 사용자가 자기 자신을 등록할 수 있다', async () => {
    await assertSucceeds(setDoc(doc(google('teacher'), 'meta/admins'), { uids: ['teacher'] }));
  });
  it('이미 관리자가 있으면 다른 사람이 등록할 수 없다', async () => {
    await assertSucceeds(setDoc(doc(google('teacher'), 'meta/admins'), { uids: ['teacher'] }));
    await assertFails(setDoc(doc(google('intruder'), 'meta/admins'), { uids: ['intruder'] }));
  });
  it('익명 로그인(심판·학생 기기)은 관리자로 등록할 수 없다', async () => {
    await assertFails(setDoc(doc(anonUser('kid'), 'meta/admins'), { uids: ['kid'] }));
  });
  it('남의 UID를 끼워 넣어 등록할 수 없다', async () => {
    await assertFails(setDoc(doc(google('teacher'), 'meta/admins'), { uids: ['teacher', 'friend'] }));
    await assertFails(setDoc(doc(google('teacher'), 'meta/admins'), { uids: ['friend'] }));
  });
  it('비로그인 사용자는 등록할 수 없다', async () => {
    await assertFails(setDoc(doc(anon(), 'meta/admins'), { uids: ['x'] }));
  });
});

describe('규칙 버전 확인', () => {
  it('누구나 규칙 버전 확인 문서를 읽을 수 있고, 쓸 수는 없다', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'meta/rulesCheck_v1')));
    await assertFails(setDoc(doc(admin(), 'meta/rulesCheck_v1'), { x: 1 }));
  });
});

describe('관리자', () => {
  it('관리자용 설정을 읽고 쓸 수 있다', async () => {
    await assertSucceeds(getDoc(doc(admin(), `${T}/private/config`)));
    await assertSucceeds(setDoc(doc(admin(), `${T}/private/config`), { config: {} }));
  });
  it('공개 문서를 쓸 수 있다', async () => {
    await assertSucceeds(setDoc(doc(admin(), `${T}/public/info`), { title: '새 제목' }));
  });
  it('관리자 목록은 앱에서 수정할 수 없다(콘솔 전용)', async () => {
    await assertFails(setDoc(doc(admin(), 'meta/admins'), { uids: ['admin', 'friend'] }));
  });
  it('변경 이력은 추가할 수 있지만 수정할 수 없다', async () => {
    await assertSucceeds(setDoc(doc(admin(), `${T}/audit/a2`), { actor: 'admin', action: 'y' }));
    await assertFails(updateDoc(doc(admin(), `${T}/audit/a1`), { action: '조작' }));
  });
  it('다른 사람 이름으로 이력을 남길 수 없다', async () => {
    await assertFails(setDoc(doc(admin(), `${T}/audit/a3`), { actor: 'someone', action: 'y' }));
  });
  it('전체 초기화를 위해 이력을 삭제할 수 있다', async () => {
    await assertSucceeds(deleteDoc(doc(admin(), `${T}/audit/a1`)));
  });
});
