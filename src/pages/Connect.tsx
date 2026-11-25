import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import rulesText from '../../firestore.rules?raw';
import { connection, USE_EMULATOR } from '../lib/firebase';
import { parseConnectionText, saveConnection, shareLink } from '../lib/connection';
import { checkRules, type RulesStatus } from '../lib/rulesVersion';

/**
 * [학교 연결] 화면
 * 각 학교가 자기 Firebase 프로젝트를 이 앱에 연결하고, 준비 상태를 점검한다.
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

function NotConnected() {
  const [text, setText] = useState('');
  const parsed = parseConnectionText(text);

  const connect = () => {
    if (!parsed) return;
    saveConnection(parsed);
    // 연결값이 바뀌면 앱을 새로 시작해야 한다. 주소의 ?s= 는 지운다.
    location.href = location.origin + location.pathname + '#/connect';
    location.reload();
  };

  return (
    <>
      <div className="card stack">
        <p>
          이 앱은 <b>학교마다 자기 Firebase(무료)</b>에 데이터를 저장합니다. 다른 학교와 데이터가 섞이지 않고, 앱 제작자도 우리 학교
          데이터를 볼 수 없습니다.
        </p>
        <p className="muted small">
          Firebase 프로젝트를 아직 만들지 않았다면 아래 '처음 준비하기'를 먼저 따라 하세요. 이미 연결된 학교의 전광판·심판 링크를 받았다면
          그 링크로 들어오면 자동으로 연결됩니다.
        </p>
      </div>
      <SetupGuide />
      <div className="card stack">
        <h2>연결값 붙여넣기</h2>
        <p className="muted small">
          Firebase 콘솔 → ⚙️ 프로젝트 설정 → 내 앱 → 'SDK 설정 및 구성'의 <code>const firebaseConfig = {'{ ... }'}</code> 부분을 통째로
          복사해서 붙여넣으세요.
        </p>
        <textarea
          style={{ minHeight: 160, fontFamily: 'monospace', fontSize: 13 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'const firebaseConfig = {\n  apiKey: "...",\n  authDomain: "...",\n  projectId: "...",\n  ...\n};'}
        />
        {text && !parsed && <div className="alert alert-warn">apiKey, projectId, appId 값을 찾지 못했습니다. 복사한 내용을 확인하세요.</div>}
        {parsed && (
          <div className="alert alert-ok">
            프로젝트 <b>{parsed.projectId}</b> 를 찾았습니다.
          </div>
        )}
        <button className="btn-primary" disabled={!parsed} onClick={connect}>
          이 학교로 연결하기
        </button>
      </div>
    </>
  );
}

function Connected() {
  const c = connection!;
  const [rules, setRules] = useState<{ status: RulesStatus | 'checking'; detail?: string }>({ status: 'checking' });
  const [copied, setCopied] = useState<string | null>(null);

  const recheck = () => {
    setRules({ status: 'checking' });
    checkRules().then(setRules);
  };
  useEffect(recheck, []);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      prompt('아래 내용을 복사하세요', value);
    }
  };

  const consoleBase = `https://console.firebase.google.com/project/${c.projectId}`;
  const boardLink = shareLink(c, '/board');

  return (
    <>
      <div className="card">
        <div className="row">
          <div className="grow">
            <div className="muted small">연결된 Firebase 프로젝트</div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{c.projectId}</div>
          </div>
          <span className="badge badge-ok">연결됨</span>
        </div>
      </div>

      <h2>준비 상태 점검</h2>
      <div className="card stack">
        <CheckRow
          ok={rules.status === 'ok' ? true : rules.status === 'checking' || rules.status === 'offline' ? null : false}
          title="① 보안 규칙"
          desc={
            rules.status === 'ok'
              ? '최신 보안 규칙이 적용되어 있습니다.'
              : rules.status === 'checking'
                ? '확인 중…'
                : rules.status === 'offline'
                  ? '인터넷 연결이 없어 확인할 수 없습니다.'
                  : rules.status === 'outdated'
                    ? '보안 규칙을 붙여넣지 않았거나 예전 버전입니다. 아래 순서대로 최신 규칙을 붙여넣으세요.'
                    : `Firestore 데이터베이스가 아직 없거나 확인에 실패했습니다. (${rules.detail})`
          }
        />
        {rules.status !== 'ok' && rules.status !== 'checking' && (
          <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
            <li>
              <button className="btn-sm" onClick={() => copy('rules', rulesText)}>
                {copied === 'rules' ? '✓ 복사됨' : '보안 규칙 복사'}
              </button>
            </li>
            <li>
              <a href={`${consoleBase}/firestore/rules`} target="_blank" rel="noreferrer">
                Firebase 콘솔의 규칙 화면 열기 ↗
              </a>{' '}
              (데이터베이스가 없다면 먼저 [데이터베이스 만들기])
            </li>
            <li>안에 있던 글을 모두 지우고 붙여넣기 → [게시]</li>
            <li>
              1분쯤 뒤{' '}
              <button className="btn-sm" onClick={recheck}>
                다시 확인
              </button>
            </li>
          </ol>
        )}
        <CheckRow
          ok={null}
          title="② 로그인 설정 (직접 확인)"
          desc={
            <>
              Authentication에서 <b>Google</b>, <b>익명</b> 로그인을 켜고, 승인된 도메인에 <code>{location.hostname}</code> 을 추가하세요.{' '}
              <button className="btn-sm" onClick={() => copy('domain', location.hostname)}>
                {copied === 'domain' ? '✓ 복사됨' : '도메인 복사'}
              </button>
              <br />
              <a href={`${consoleBase}/authentication/providers`} target="_blank" rel="noreferrer">
                로그인 방법 열기 ↗
              </a>{' '}
              ·{' '}
              <a href={`${consoleBase}/authentication/settings`} target="_blank" rel="noreferrer">
                승인된 도메인 열기 ↗
              </a>
            </>
          }
        />
        <CheckRow
          ok={null}
          title="③ 관리자 등록"
          desc={
            <>
              <Link to="/admin">관리자 화면</Link>에서 Google로 로그인한 뒤 [이 계정을 관리자로 등록]을 누르세요. 처음 한 명만 등록할 수
              있습니다.
            </>
          }
        />
      </div>

      <h2>다른 기기에 나눠 줄 링크</h2>
      <div className="card stack">
        <p className="muted small">이 링크로 들어오면 따로 연결하지 않아도 이 학교에 자동으로 연결됩니다.</p>
        <div className="row">
          <span className="grow">📺 전광판 링크</span>
          <button className="btn-sm" onClick={() => copy('board', boardLink)}>
            {copied === 'board' ? '✓ 복사됨' : '복사'}
          </button>
        </div>
        <p className="muted small">심판 입력 링크(종목별 QR)는 3단계에서 관리자 화면에 추가됩니다.</p>
      </div>

      {!USE_EMULATOR && (
        <div className="card stack">
          <h3>연결 해제</h3>
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
        </div>
      )}
    </>
  );
}

function CheckRow({ ok, title, desc }: { ok: boolean | null; title: string; desc: React.ReactNode }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
      <span style={{ fontSize: 20, width: 26 }}>{ok === true ? '✅' : ok === false ? '⚠️' : '👉'}</span>
      <div className="grow">
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div className="small">{desc}</div>
      </div>
    </div>
  );
}

function SetupGuide() {
  return (
    <details className="card">
      <summary style={{ fontWeight: 700, cursor: 'pointer' }}>📘 처음 준비하기: Firebase 프로젝트 만들기 (약 10분, 무료)</summary>
      <ol className="small" style={{ paddingLeft: 20, marginBottom: 0 }}>
        <li>
          <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer">
            console.firebase.google.com
          </a>{' '}
          접속 → 학교 업무용 Google 계정으로 로그인
        </li>
        <li>[프로젝트 만들기] → 이름 예: sports-day-우리학교 → (Gemini, 애널리틱스는 꺼도 됨) → 만들기</li>
        <li>
          왼쪽 메뉴 [빌드 → Firestore Database] → [데이터베이스 만들기] → 위치 <b>asia-northeast3 (Seoul)</b> → <b>프로덕션 모드</b> →
          만들기
        </li>
        <li>[빌드 → Authentication] → [시작하기] → 로그인 방법에서 <b>Google</b> 사용 설정(지원 이메일 선택) → 저장, 이어서 <b>익명</b>도 사용 설정</li>
        <li>
          Authentication → [설정] 탭 → [승인된 도메인] → [도메인 추가] → <code>{location.hostname}</code>
        </li>
        <li>왼쪽 위 ⚙️ → [프로젝트 설정] → 아래 '내 앱'에서 웹 아이콘 <code>{'</>'}</code> → 앱 닉네임 입력 → [앱 등록]</li>
        <li>화면에 나온 firebaseConfig 부분을 복사해 아래 칸에 붙여넣기</li>
      </ol>
      <p className="muted small" style={{ marginBottom: 0 }}>
        카드 등록이 필요 없는 무료(Spark) 요금제 그대로 쓰면 됩니다. 비용이 청구되지 않습니다.
      </p>
    </details>
  );
}
