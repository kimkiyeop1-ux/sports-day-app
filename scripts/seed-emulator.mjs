// 로컬 에뮬레이터 전용: 테스트 관리자 계정(admin@test.local / test1234)을 만들고 관리자로 등록
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FS = 'http://127.0.0.1:8080/v1/projects/demo-sportsday/databases/(default)/documents';
const email = 'admin@test.local';
const password = 'test1234';

let res = await fetch(`${AUTH}/accounts:signUp?key=demo-key`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, returnSecureToken: true }),
});
let data = await res.json();
if (!res.ok) {
  res = await fetch(`${AUTH}/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  data = await res.json();
}
const uid = data.localId;
await fetch(`${FS}/meta/admins`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
  body: JSON.stringify({ fields: { uids: { arrayValue: { values: [{ stringValue: uid }] } } } }),
});
console.log(`테스트 관리자 등록 완료: ${email} / ${password} (uid ${uid})`);
