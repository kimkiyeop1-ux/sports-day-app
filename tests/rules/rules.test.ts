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
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, writeBatch } from 'firebase/firestore';

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
    await assertSucceeds(getDoc(doc(anon(), 'meta/rulesCheck_v3')));
    await assertSucceeds(getDoc(doc(anon(), 'meta/rulesCheck_v2')));
    // 안정판(예전 버전) 앱도 이 규칙을 최신으로 인식
    await assertSucceeds(getDoc(doc(anon(), 'meta/rulesCheck_v1')));
    await assertFails(getDoc(doc(anon(), 'meta/rulesCheck_v4')));
    await assertFails(setDoc(doc(admin(), 'meta/rulesCheck_v2'), { x: 1 }));
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

describe('대진표(2단계)', () => {
  const B = `${T}/private/bracket_dodgeball`;
  const PB = `${T}/public/bracket_dodgeball`;
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, B), { json: '{}', updatedAt: 1 });
      await setDoc(doc(db, PB), { json: '{}', updatedAt: 1 });
    });
  });
  it('누구나 공개 대진표를 읽을 수 있다', async () => {
    await assertSucceeds(getDoc(doc(anon(), PB)));
  });
  it('비로그인·일반 사용자는 대진표 원본(메모 포함)을 읽을 수 없다', async () => {
    await assertFails(getDoc(doc(anon(), B)));
    await assertFails(getDoc(doc(stranger(), B)));
  });
  it('비로그인·일반 사용자는 경기 결과를 고칠 수 없다', async () => {
    await assertFails(setDoc(doc(anon(), PB), { json: '{"results":{}}', updatedAt: 2 }));
    await assertFails(setDoc(doc(stranger(), PB), { json: '{"results":{}}', updatedAt: 2 }));
    await assertFails(setDoc(doc(stranger(), B), { json: '{}', updatedAt: 2 }));
  });
  it('관리자는 대진표 원본과 공개본을 쓸 수 있다', async () => {
    await assertSucceeds(setDoc(doc(admin(), B), { json: '{}', updatedAt: 2 }));
    await assertSucceeds(setDoc(doc(admin(), PB), { json: '{}', updatedAt: 2 }));
  });
});

describe('심판 링크 + PIN (3단계)', () => {
  const KEY = `${T}/private/referee`;
  const RES = `${T}/public/results_dodgeball`;
  const RES2 = `${T}/public/results_kickball`;
  const ref = (uid = 'ref1') => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } } as any).firestore();
  const session = (pin = '123456', token = 'tokA', ev = 'dodgeball') => ({ ev, token, pin, name: '김선생', at: 1 });
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, KEY), { keys: { dodgeball: { token: 'tokA', pin: '123456' }, kickball: { token: 'tokB', pin: '654321' } } });
      await setDoc(doc(db, RES), { r: {}, rec: {}, updatedAt: 1 });
      await setDoc(doc(db, RES2), { r: {}, rec: {}, updatedAt: 1 });
    });
  });

  it('PIN·링크 원본은 심판·학생이 읽을 수 없다', async () => {
    await assertFails(getDoc(doc(anon(), KEY)));
    await assertFails(getDoc(doc(ref(), KEY)));
  });
  it('PIN이 틀리면 심판 세션을 만들 수 없다', async () => {
    await assertFails(setDoc(doc(ref(), `${T}/refSessions/ref1`), session('000000')));
  });
  it('링크 토큰이 틀리면 심판 세션을 만들 수 없다', async () => {
    await assertFails(setDoc(doc(ref(), `${T}/refSessions/ref1`), session('123456', 'wrong')));
  });
  it('다른 사람 이름(UID)으로 세션을 만들 수 없다', async () => {
    await assertFails(setDoc(doc(ref('ref1'), `${T}/refSessions/ref2`), session()));
  });
  it('이름이 비어 있으면 세션을 만들 수 없다', async () => {
    await assertFails(setDoc(doc(ref(), `${T}/refSessions/ref1`), { ...session(), name: '' }));
  });
  it('PIN·토큰이 맞으면 세션을 만들고, 자기 종목 결과를 입력할 수 있다', async () => {
    await assertSucceeds(setDoc(doc(ref(), `${T}/refSessions/ref1`), session()));
    await assertSucceeds(getDoc(doc(ref(), `${T}/refSessions/ref1`)));
    await assertSucceeds(updateDoc(doc(ref(), RES), { 'r.g2-R1-1': '{"a":2,"b":1}', updatedAt: 2 }));
    await assertSucceeds(setDoc(doc(ref(), `${T}/audit/r1`), { actor: 'ref1', ev: 'dodgeball', action: '경기 결과 입력' }));
  });
  it('심판은 다른 종목 결과·대진표·설정·이력을 건드릴 수 없다', async () => {
    await setDoc(doc(ref(), `${T}/refSessions/ref1`), session());
    const db = ref();
    await assertFails(updateDoc(doc(db, RES2), { 'r.g2-G0-1': '{}', updatedAt: 2 }));
    await assertFails(setDoc(doc(db, `${T}/public/bracket_dodgeball`), { json: '{}' }));
    await assertFails(setDoc(doc(db, `${T}/public/info`), { title: 'x' }));
    await assertFails(getDoc(doc(db, `${T}/private/config`)));
    await assertFails(getDoc(doc(db, `${T}/audit/a1`)));
    await assertFails(setDoc(doc(db, `${T}/audit/r2`), { actor: 'ref1', ev: 'kickball', action: 'x' }));
    await assertFails(updateDoc(doc(db, RES), { hacked: true }));
    await assertFails(getDoc(doc(db, `${T}/refSessions/other`)));
  });
  it('관리자가 PIN을 바꾸면 예전 심판 세션으로는 입력할 수 없다', async () => {
    await setDoc(doc(ref(), `${T}/refSessions/ref1`), session());
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), KEY), { keys: { dodgeball: { token: 'tokA', pin: '999999' } } }),
    );
    await assertFails(updateDoc(doc(ref(), RES), { 'r.g2-R1-1': '{}', updatedAt: 3 }));
  });
  it('세션이 없는 로그인 사용자는 결과를 입력할 수 없다', async () => {
    await assertFails(updateDoc(doc(stranger(), RES), { 'r.g2-R1-1': '{}', updatedAt: 2 }));
    await assertFails(updateDoc(doc(anon(), RES), { 'r.g2-R1-1': '{}', updatedAt: 2 }));
  });
  it('관리자는 심판 세션 목록을 볼 수 있다', async () => {
    await setDoc(doc(ref(), `${T}/refSessions/ref1`), session());
    await assertSucceeds(getDocs(collection(admin(), `${T}/refSessions`)));
    await assertFails(getDocs(collection(ref(), `${T}/refSessions`)));
  });
});

describe('블라인드·최종 공개 (5단계)', () => {
  const KEY = `${T}/private/referee`;
  const RES = `${T}/public/results_dodgeball`;
  const HID = `${T}/hidden/results_dodgeball`;
  const BLIND = `${T}/public/blind`;
  const REV = `${T}/reveal/all`;
  const dev = (uid: string) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } } as any).firestore();
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, KEY), { keys: { dodgeball: { token: 'tokA', pin: '123456' }, _presenter: { token: 'tokP', pin: '777777' } } });
      await setDoc(doc(db, RES), { r: {}, rec: {}, updatedAt: 1 });
      await setDoc(doc(db, BLIND), { events: { dodgeball: true } });
      await setDoc(doc(db, REV), { rows: [{ id: '2-1', rank: 1 }] });
    });
    await setDoc(doc(dev('ref1'), `${T}/refSessions/ref1`), { ev: 'dodgeball', token: 'tokA', pin: '123456', name: '심판', at: 1 });
    await setDoc(doc(dev('mc'), `${T}/refSessions/mc`), { ev: '_presenter', token: 'tokP', pin: '777777', name: '진행', at: 1 });
  });

  it('블라인드 중에는 심판도 관리자도 공개 결과를 고칠 수 없다', async () => {
    await assertFails(updateDoc(doc(dev('ref1'), RES), { 'r.m1': '{"a":1,"b":0}', updatedAt: 2 }));
    await assertFails(updateDoc(doc(admin(), RES), { 'r.m1': '{"a":1,"b":0}', updatedAt: 2 }));
  });
  it('블라인드 중 결과는 숨김 문서에 쓰고, 학생·다른 사람은 읽을 수 없다', async () => {
    await assertSucceeds(setDoc(doc(dev('ref1'), HID), { r: { m1: '{"a":1,"b":0}' }, updatedAt: 2 }));
    await assertSucceeds(getDoc(doc(dev('ref1'), HID)));
    await assertSucceeds(getDoc(doc(admin(), HID)));
    await assertFails(getDoc(doc(anon(), HID)));
    await assertFails(getDoc(doc(stranger(), HID)));
    await assertFails(getDoc(doc(dev('mc'), HID)));
    await assertFails(setDoc(doc(dev('ref1'), HID), { r: {}, hacked: 1 }));
  });
  it('블라인드는 관리자만 켜고 끌 수 있다', async () => {
    await assertFails(setDoc(doc(dev('ref1'), BLIND), { events: {} }));
    await assertFails(setDoc(doc(anon(), BLIND), { events: {} }));
    await assertSucceeds(getDoc(doc(anon(), BLIND)));
  });
  it('[결과 공개]: 블라인드 해제와 같은 묶음이면 관리자가 공개본에 옮길 수 있다', async () => {
    const db = admin();
    const b = writeBatch(db);
    b.set(doc(db, BLIND), { events: { dodgeball: false } });
    b.set(doc(db, RES), { r: { m1: '{"a":1,"b":0}' }, rec: {}, updatedAt: 3 });
    await assertSucceeds(b.commit());
    // 해제 뒤에는 심판도 다시 공개본에 입력 가능
    await assertSucceeds(updateDoc(doc(dev('ref1'), RES), { 'r.m2': '{"a":2,"b":0}', updatedAt: 4 }));
  });
  it('최종 순위 자료는 관리자와 공개 진행자만 읽는다', async () => {
    await assertSucceeds(getDoc(doc(admin(), REV)));
    await assertSucceeds(getDoc(doc(dev('mc'), REV)));
    await assertFails(getDoc(doc(dev('ref1'), REV)));
    await assertFails(getDoc(doc(anon(), REV)));
    await assertFails(setDoc(doc(dev('mc'), REV), { rows: [] }));
  });
  it('공개 진행자는 경기 결과를 쓸 수 없다', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), BLIND), { events: {} }));
    await assertFails(updateDoc(doc(dev('mc'), RES), { 'r.m1': '{}', updatedAt: 5 }));
  });
});
