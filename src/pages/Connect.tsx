import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import rulesText from '../../firestore.rules?raw';
import { connection, USE_EMULATOR } from '../lib/firebase';
import { parseConnectionText, saveConnection, shareLink } from '../lib/connection';
import { checkSetup, consoleUrl, parseProjectId, type CheckState, type SetupStatus } from '../lib/setupCheck';

/**
 * [학교 연결] 화면
 * Firebase 메뉴 이름을 몰라도 되도록: 앱이 빠진 설정을 직접 확인하고,
 * 고쳐야 할 것만 '정확한 Firebase 화면을 여는 버튼'으로 보여 준다.
 */
export default function Connect() {
  return (
    <div className="page">
      <p>
        <Link to="/">← 처음 화면</Link>
      </p>
      <h1>🏫 학교 연결</h1>
      {connection ? <Connected /> : <NotConnected />}
    </div>
  );
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    prompt('아래 내용을 복사하세요', value);
    return false;
  }
}

function OpenButton({ href, children, primary = true }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <a className={`btn ${primary ? 'btn-primary' : ''}`} href={href} target="_blank" rel="noreferrer">
      {children} ↗
    </a>
  );
}

// ================= 연결 전 =================

function NotConnected() {
  const [pidText, setPidText] = useState('');
  const pid = parseProjectId(pidText);
  const [text, setText] = useState('');
  const parsed = parseConnectionText(text);
  const mismatch = parsed && pid && parsed.projectId !== pid;

  const connect = () => {
    if (!parsed) return;
    saveConnection(parsed);
    // 연결값이 바뀌면 앱을 새로 시작해야 한다. 주소의 ?s= 는 지운다.
    location.href = location.origin + location.pathname + '#/connect';
    location.reload();
  };

  return (
    <>
      <p className="muted">
        학교마다 자기 Firebase(Google의 무료 저장소)에 대회 기록을 저장합니다. 두 단계만 하면 나머지는 이 화면이 하나씩 확인해 줍니다.
      </p>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>1. Firebase 프로젝트 이름 넣기</h2>
        <p className="small" style={{ margin: 0 }}>
          Firebase 화면 맨 위에 보이는 이름입니다(예: <code>sports-day-urihakgyo</code>). 주소창의 주소를 통째로 붙여넣어도 됩니다.
        </p>
        <input value={pidText} onChange={(e) => setPidText(e.target.value)} placeholder="sports-day-우리학교" aria-label="Firebase 프로젝트 이름" />
        {pidText && !pid && <div className="alert alert-warn">이름을 알아보지 못했습니다. 영문 소문자·숫자·하이픈(-)으로 된 이름을 넣어 주세요.</div>}
        <details>
          <summary className="small">아직 Firebase 프로젝트가 없어요</summary>
          <div className="stack small" style={{ marginTop: 8 }}>
            <OpenButton href={consoleUrl.home} primary={false}>Firebase 열기</OpenButton>
            <div>학교 업무용 Google 계정으로 로그인 → <b>프로젝트 만들기</b>(또는 <b>새 프로젝트</b>) → 이름 입력 → 나머지는 <b>계속</b>만 누르면 됩니다. 만든 뒤 위 칸에 이름을 넣으세요.</div>
          </div>
        </details>
      </div>

      <div className="card stack" style={{ opacity: pid || parsed ? 1 : 0.55 }}>
        <h2 style={{ margin: 0 }}>2. 연결 정보 복사해 오기</h2>
        {pid ? (
          <OpenButton href={consoleUrl.settings(pid)}>연결 정보 화면 열기</OpenButton>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>1번에 이름을 넣으면 버튼이 생깁니다.</p>
        )}
        <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
          <li>열린 화면을 <b>맨 아래까지</b> 내립니다.</li>
          <li><code>const firebaseConfig = {'{'}</code> 로 시작하는 글을 복사합니다(옆의 복사 아이콘).</li>
          <li>그런 글이 없으면 <code>&lt;/&gt;</code> 모양 버튼을 눌러 이름만 넣고 등록하세요. 그러면 나타납니다.</li>
        </ol>
        <textarea
          style={{ minHeight: 140, fontFamily: 'monospace', fontSize: 13 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'여기에 붙여넣기\n\nconst firebaseConfig = {\n  apiKey: "...",\n  projectId: "...",\n  ...\n};'}
          aria-label="연결 정보 붙여넣기"
        />
        {text && !parsed && <div className="alert alert-warn">연결 정보를 찾지 못했습니다. <code>firebaseConfig</code> 글 전체를 복사했는지 확인하세요.</div>}
        {mismatch && <div className="alert alert-warn">붙여넣은 정보는 <b>{parsed!.projectId}</b> 프로젝트입니다. 1번 이름과 다릅니다. 맞는지 확인하세요.</div>}
        {parsed && !mismatch && <div className="alert alert-ok">✅ <b>{parsed.projectId}</b> 프로젝트를 찾았습니다.</div>}
        <button className="btn-primary" disabled={!parsed} onClick={connect} style={{ fontSize: 17 }}>
          연결하기
        </button>
      </div>
    </>
  );
}

// ================= 연결 후: 자동 점검 =================

interface Item {
  key: string;
  title: string;
  why: string;
  state: CheckState | 'checking';
  fix: React.ReactNode;
}

function Connected() {
  const c = connection!;
  const p = c.projectId;
  const [st, setSt] = useState<SetupStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const last = useRef(0);

  const recheck = useCallback(() => {
    last.current = Date.now();
    setChecking(true);
    checkSetup(c)
      .then(setSt)
      .finally(() => setChecking(false));
  }, [c]);
  useEffect(recheck, [recheck]);
  // Firebase 탭에서 설정하고 돌아오면 자동으로 다시 확인
  useEffect(() => {
    const onFocus = () => Date.now() - last.current > 4000 && recheck();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [recheck]);

  const copy = async (label: string, value: string) => {
    if (await copyText(value)) {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    }
  };
  const s = (k: keyof SetupStatus): CheckState | 'checking' => (!st || checking ? 'checking' : (st[k] as CheckState));

  const items: Item[] = [
    {
      key: 'database',
      title: '데이터베이스',
      why: '대회 기록을 저장하는 곳',
      state: s('database'),
      fix: (
        <>
          <OpenButton href={consoleUrl.firestore(p)}>데이터베이스 화면 열기</OpenButton>
          <div>
            <b>데이터베이스 만들기</b> → 위치는 <b>asia-northeast3 (Seoul)</b> → <b>프로덕션 모드</b> → 만들기
          </div>
        </>
      ),
    },
    {
      key: 'rules',
      title: '보안 규칙',
      why: '총점·순위를 관리자만 볼 수 있게 지키는 장치',
      state: st?.database === 'missing' && !checking ? 'missing' : s('rules'),
      fix: (
        <>
          <div className="row">
            <button className="btn-primary" onClick={() => copy('rules', rulesText)}>{copied === 'rules' ? '✅ 복사됨' : '① 규칙 복사'}</button>
            <OpenButton href={consoleUrl.rules(p)}>② 규칙 화면 열기</OpenButton>
          </div>
          <div>열린 화면의 글을 <b>모두 지우고</b> 붙여넣은 뒤 <b>게시</b>. (데이터베이스를 먼저 만들어야 합니다)</div>
          <div className="muted">
            글 쓰는 칸이 안 보이면: 열린 화면 위쪽의 <b>규칙</b>(Rules) 탭을 누르세요. 데이터베이스 목록이 나오면 <b>(default)</b>를 먼저 누른 뒤 <b>규칙</b> 탭을 누르세요.
          </div>
        </>
      ),
    },
    {
      key: 'anonymous',
      title: '심판·진행자용 로그인',
      why: '심판 폰이 이름·PIN만으로 들어오게 하는 설정',
      state: s('anonymous'),
      fix: (
        <>
          <OpenButton href={consoleUrl.providers(p)}>로그인 설정 화면 열기</OpenButton>
          <div>
            {st?.authNotStarted && <><b>시작하기</b>를 누른 뒤, </>}목록에서 <b>익명</b>을 골라 <b>사용 설정</b> → 저장
            <span className="muted"> (목록에 없으면 '새 제공업체 추가' 안에 있습니다)</span>
          </div>
        </>
      ),
    },
    {
      key: 'google',
      title: '관리자용 Google 로그인',
      why: '관리자가 Google 계정으로 들어오게 하는 설정',
      state: s('google'),
      fix: (
        <>
          <OpenButton href={consoleUrl.providers(p)}>로그인 설정 화면 열기</OpenButton>
          <div>
            목록에서 <b>Google</b>을 골라 <b>사용 설정</b> → 지원 이메일에서 내 계정 선택 → 저장
          </div>
        </>
      ),
    },
    {
      key: 'domain',
      title: '이 사이트 주소 허용',
      why: `Google 로그인 창이 이 주소(${location.hostname})에서 열리도록 허용`,
      state: s('domain'),
      fix: (
        <>
          <div className="row">
            <button className="btn-primary" onClick={() => copy('domain', location.hostname)}>{copied === 'domain' ? '✅ 복사됨' : '① 주소 복사'}</button>
            <OpenButton href={consoleUrl.domains(p)}>② 허용 주소 화면 열기</OpenButton>
          </div>
          <div>
            <b>도메인 추가</b> → 붙여넣기(<code>{location.hostname}</code>) → 추가
          </div>
        </>
      ),
    },
  ];

  const done = items.filter((i) => i.state === 'ok').length;
  const firstTodo = items.find((i) => i.state === 'missing' || i.state === 'unknown');
  const allOk = done === items.length;

  return (
    <>
      <div className="card">
        <div className="row">
          <div className="grow">
            <div className="muted small">연결된 Firebase 프로젝트</div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{p}</div>
          </div>
          <span className={`badge ${allOk ? 'badge-ok' : 'badge-warn'}`}>준비 {checking || !st ? '확인 중' : `${done}/${items.length}`}</span>
        </div>
      </div>

      {st?.offline && <div className="alert alert-warn">인터넷 연결이 없어 확인할 수 없습니다.</div>}

      <div className="row" style={{ margin: '16px 0 8px' }}>
        <h2 className="grow" style={{ margin: 0 }}>준비 상태</h2>
        <button className="btn-sm" onClick={recheck} disabled={checking}>{checking ? '확인 중…' : '다시 확인'}</button>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        앱이 직접 확인합니다. ❌인 것만 버튼을 눌러 고치고 이 화면으로 돌아오면 자동으로 다시 확인합니다(설정 반영에 1분쯤 걸릴 수 있어요).
      </p>

      <div className="card" style={{ padding: 0 }}>
        {items.map((it) => {
          const open = it === firstTodo;
          return (
            <div key={it.key} className={`setup-item ${open ? 'setup-now' : ''}`}>
              <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <span className="setup-icon">
                  {it.state === 'ok' ? '✅' : it.state === 'missing' ? '❌' : it.state === 'checking' ? '⏳' : '❔'}
                </span>
                <div className="grow">
                  <div style={{ fontWeight: 700 }}>
                    {it.title} {open && <span className="badge badge-primary">지금 할 일</span>}
                  </div>
                  <div className="muted small">
                    {it.why}
                    {it.state === 'unknown' && ' · 자동 확인이 안 됐습니다. 아래 버튼으로 직접 확인해 주세요.'}
                  </div>
                </div>
              </div>
              {(it.state === 'missing' || it.state === 'unknown') && <div className="setup-fix stack small">{it.fix}</div>}
            </div>
          );
        })}
        <div className={`setup-item ${allOk ? 'setup-now' : ''}`}>
          <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <span className="setup-icon">👤</span>
            <div className="grow">
              <div style={{ fontWeight: 700 }}>
                관리자 등록 {allOk && <span className="badge badge-primary">지금 할 일</span>}
              </div>
              <div className="muted small">위가 모두 ✅이면 관리자 화면에서 Google로 로그인 → [이 계정을 관리자로 등록]. 처음 한 명만 됩니다.</div>
            </div>
          </div>
          <div className="setup-fix">
            <Link className={`btn ${allOk ? 'btn-primary' : ''}`} to="/admin">관리자 화면으로</Link>
          </div>
        </div>
      </div>

      <h2 style={{ marginTop: 24 }}>다른 기기에 나눠 줄 링크</h2>
      <div className="card stack">
        <p className="muted small" style={{ margin: 0 }}>이 링크로 들어오면 따로 연결하지 않아도 이 학교에 자동으로 연결됩니다. 심판·진행자 링크는 관리자 화면에서 만듭니다.</p>
        <div className="row">
          <span className="grow">📺 전광판 링크</span>
          <button className="btn-sm" onClick={() => copy('board', shareLink(c, '/board'))}>{copied === 'board' ? '✅ 복사됨' : '복사'}</button>
        </div>
        <div className="row">
          <span className="grow">📋 학생용 공개 대진표 링크</span>
          <button className="btn-sm" onClick={() => copy('bracket', shareLink(c, '/bracket'))}>{copied === 'bracket' ? '✅ 복사됨' : '복사'}</button>
        </div>
      </div>

      {!USE_EMULATOR && (
        <details className="card">
          <summary className="small" style={{ cursor: 'pointer' }}>다른 Firebase 프로젝트로 바꾸기(연결 해제)</summary>
          <p className="muted small">이 기기에서만 연결을 해제합니다. 학교 데이터는 지워지지 않습니다.</p>
          <button
            className="btn-danger"
            onClick={() => {
              if (!confirm('이 기기의 학교 연결을 해제할까요?')) return;
              saveConnection(null);
              location.href = location.origin + location.pathname + '#/connect';
              location.reload();
            }}
          >
            연결 해제
          </button>
        </details>
      )}
    </>
  );
}
