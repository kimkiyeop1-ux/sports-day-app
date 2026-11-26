import { useState } from 'react';
import { Link, NavLink, Outlet, useOutletContext } from 'react-router-dom';
import { doc, setDoc } from 'firebase/firestore';
import { GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup, signOut } from 'firebase/auth';
import { auth, db, isConfigured, USE_EMULATOR } from '../../lib/firebase';
import { useActiveTournament, useAuthUser, useDoc, useOnline } from '../../data/hooks';
import { paths, type ConfigDoc, type ScenarioDoc } from '../../data/store';
import type { TournamentConfig } from '../../config/types';
import type { DoneMap } from '../../lib/scenario';

export interface AdminCtx {
  tid: string | null;
  config: TournamentConfig | null;
  done: DoneMap;
  loading: boolean;
}
export const useAdmin = () => useOutletContext<AdminCtx>();

export function SyncBadge({ pending }: { pending: boolean }) {
  const online = useOnline();
  if (!online) return <span className="sync sync-off">오프라인 · 기기에 저장 중</span>;
  if (pending) return <span className="sync sync-pending">전송 중…</span>;
  return <span className="sync sync-ok">실시간 연결됨</span>;
}

export default function AdminLayout() {
  const { user, ready } = useAuthUser();
  const admins = useDoc<{ uids: string[] }>(user ? paths.admins : null);
  const isAdmin = !!user && !!admins.data?.uids?.includes(user.uid);
  const { tid, loading: tidLoading } = useActiveTournament();
  const cfg = useDoc<ConfigDoc>(isAdmin && tid ? paths.config(tid) : null);
  const sc = useDoc<ScenarioDoc>(isAdmin && tid ? paths.scenario(tid) : null);

  if (!isConfigured) {
    return (
      <div className="page">
        <div className="alert alert-warn">
          아직 학교 Firebase가 연결되지 않았습니다. <Link to="/connect">학교 연결 화면</Link>에서 먼저 연결하세요.
        </div>
      </div>
    );
  }
  if (!ready || (user && admins.loading)) return <div className="page muted">불러오는 중…</div>;

  if (!user) return <LoginScreen />;

  if (!isAdmin) return <NotAdmin />;

  const ctx: AdminCtx = {
    tid,
    config: cfg.data?.config ?? null,
    done: sc.data?.done ?? {},
    loading: tidLoading || cfg.loading,
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="title">
            체육대회 원앱
          </NavLink>
          <span className="grow" />
          <SyncBadge pending={cfg.pending || sc.pending} />
        </div>
        <nav className="nav">
          <NavLink to="/admin" end>
            대시보드
          </NavLink>
          <NavLink to="/admin/scenario">시나리오 진행</NavLink>
          <NavLink to="/admin/bracket">대진표</NavLink>
          <NavLink to="/admin/referee">심판 링크</NavLink>
          <NavLink to="/admin/scores">점수·순위</NavLink>
          <NavLink to="/admin/reveal">블라인드·공개</NavLink>
          <NavLink to="/admin/history">변경 이력</NavLink>
          <NavLink to="/admin/backup">백업·리허설</NavLink>
          <NavLink to="/admin/setup">대회 설정</NavLink>
          <a href="#/board" target="_blank" rel="noreferrer">
            전광판 ↗
          </a>
          <a href="#/bracket" target="_blank" rel="noreferrer">
            공개 대진표 ↗
          </a>
        </nav>
      </div>
      <div className="page">
        {ctx.config?.rehearsalOf && (
          <div className="alert alert-warn">
            🎭 <b>리허설 중</b>입니다. 진짜 대회 기록에는 영향이 없습니다. <NavLink to="/admin/backup">리허설 끝내기 →</NavLink>
          </div>
        )}
        {ctx.loading ? <p className="muted">불러오는 중…</p> : <Outlet context={ctx} />}
      </div>
    </>
  );
}

/** 로그인했지만 관리자가 아닐 때: 최초 1회 '관리자 등록' */
function NotAdmin() {
  const user = auth.currentUser!;
  const [state, setState] = useState<'idle' | 'busy' | 'taken'>('idle');
  const claim = async () => {
    setState('busy');
    try {
      await setDoc(doc(db, paths.admins), { uids: [user.uid] });
      location.reload();
    } catch {
      setState('taken');
    }
  };
  const isGoogle = user.providerData.some((p) => p.providerId === 'google.com');
  return (
    <div className="page">
      <h1>관리자 등록</h1>
      <div className="card stack">
        <p>
          로그인한 계정: <b>{user.email ?? '(이메일 없음)'}</b>
        </p>
        {state !== 'taken' ? (
          <>
            <p>이 학교에 처음 접속했다면 아래 버튼으로 이 계정을 관리자로 등록하세요. <b>처음 한 명만</b> 등록할 수 있습니다.</p>
            <button className="btn-primary" disabled={state === 'busy' || !isGoogle} onClick={claim}>
              이 계정을 관리자로 등록
            </button>
            {!isGoogle && <p className="muted small">관리자는 Google 계정으로 로그인해야 합니다.</p>}
          </>
        ) : (
          <div className="alert alert-warn">
            이 학교에는 이미 관리자가 등록되어 있습니다. 관리자를 바꾸거나 추가하려면 Firebase 콘솔 → Firestore → <code>meta/admins</code> 문서의{' '}
            <code>uids</code> 목록에 아래 UID를 넣으세요. (보안 규칙을 붙여넣지 않은 경우에도 이 메시지가 나옵니다 — <Link to="/connect">학교 연결</Link>에서 점검)
          </div>
        )}
        <div className="row">
          <input readOnly value={user.uid} className="grow" onFocus={(e) => e.target.select()} aria-label="UID" />
          <button onClick={() => navigator.clipboard?.writeText(user.uid)}>UID 복사</button>
        </div>
        <button onClick={() => signOut(auth)}>로그아웃</button>
      </div>
    </div>
  );
}

function LoginScreen() {
  const [err, setErr] = useState<string | null>(null);
  const google = async () => {
    setErr(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e: any) {
      const code = String(e?.code ?? '');
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      setErr(
        code === 'auth/unauthorized-domain'
          ? '이 사이트 주소가 Firebase에 허용되어 있지 않습니다.'
          : code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found'
            ? 'Firebase에서 Google 로그인이 꺼져 있습니다.'
            : code === 'auth/popup-blocked'
              ? '팝업이 막혔습니다. 주소창 오른쪽의 팝업 차단 아이콘을 눌러 허용한 뒤 다시 누르세요.'
              : '로그인 실패: ' + (code || e?.message),
      );
    }
  };
  return (
    <div className="page">
      <h1>관리자 로그인</h1>
      <div className="card stack">
        <p className="muted">관리자로 등록된 Google 계정으로 로그인하세요.</p>
        <button className="btn-primary" onClick={google}>
          Google 계정으로 로그인
        </button>
        {err && (
          <div className="alert alert-danger">
            {err} <Link to="/connect">학교 연결 화면에서 확인하기 →</Link>
          </div>
        )}
        {USE_EMULATOR && (
          <button onClick={() => signInWithEmailAndPassword(auth, 'admin@test.local', 'test1234')}>
            (개발용) 테스트 관리자로 로그인
          </button>
        )}
      </div>
    </div>
  );
}
