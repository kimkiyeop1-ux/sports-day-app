// 공개 진행자 화면 (#/reveal/{토큰}) — 진행 교사가 링크 + PIN으로 들어와 폐회식에서 최종 순위를 발표한다.
// 읽는 데이터: 관리자가 만들어 둔 발표 자료(reveal/*)뿐. 이 자료는 관리자와 진행자만 읽을 수 있다.
import { lazy, Suspense, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { auth, isConfigured } from '../../lib/firebase';
import { useActiveTournament, useAuthUser, useCollection, useDoc } from '../../data/hooks';
import { paths, PRESENTER, type RefSessionDoc, type RevealDoc } from '../../data/store';
import { ensureAnon, PinForm } from '../referee/Referee';

const RevealStage = lazy(() => import('./RevealStage'));

export default function Reveal() {
  const { token = '' } = useParams();
  const { tid, loading: tidLoading } = useActiveTournament();
  const { user, ready } = useAuthUser();
  const [authErr, setAuthErr] = useState<string | null>(null);
  useEffect(() => {
    if (isConfigured && ready && !user) ensureAnon().catch((e: any) => setAuthErr(e.code ?? e.message));
  }, [ready, user]);
  const sess = useDoc<RefSessionDoc>(tid && user ? paths.refSession(tid, user.uid) : null);
  const [revoked, setRevoked] = useState(false);
  const valid = !!sess.data && !sess.pending && sess.data.ev === PRESENTER && sess.data.token === token && !revoked;

  if (!isConfigured) return <div className="page"><div className="alert alert-warn">학교 연결 정보가 없습니다. 관리자에게 받은 링크를 그대로 열어 주세요.</div></div>;
  if (authErr) return <div className="page"><div className="alert alert-danger">로그인 실패: {authErr}</div></div>;
  if (!ready || !user || tidLoading || sess.loading) return <div className="page muted">불러오는 중…</div>;
  if (!tid) return <div className="page"><div className="alert alert-warn">진행 중인 대회가 없습니다.</div></div>;
  if (!valid)
    return <PinForm tid={tid} uid={auth.currentUser!.uid} eventId={PRESENTER} token={token} revoked={revoked} onDone={() => setRevoked(false)}
      title="최종 순위 발표" heading="🏆 공개 진행자" />;
  return <Packages tid={tid} onRevoked={() => setRevoked(true)} />;
}

function Packages({ tid, onRevoked }: { tid: string; onRevoked: () => void }) {
  const list = useCollection<RevealDoc>(paths.revealCol(tid));
  const [open, setOpen] = useState<RevealDoc | null>(null);
  useEffect(() => {
    if (list.error === 'permission-denied') onRevoked();
  }, [list.error, onRevoked]);
  if (open)
    return (
      <Suspense fallback={<div className="page muted">불러오는 중…</div>}>
        <RevealStage doc={open} title={`${open.title} 최종 순위`} onExit={() => setOpen(null)} />
      </Suspense>
    );
  const docs = [...list.docs].sort((a, b) => (a.scope === 'all' ? -1 : b.scope === 'all' ? 1 : a.scope.localeCompare(b.scope)));
  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <h1>🏆 최종 순위 발표</h1>
      {list.loading ? (
        <p className="muted">불러오는 중…</p>
      ) : docs.length === 0 ? (
        <div className="card muted">아직 발표 자료가 없습니다. 관리자에게 [발표 자료 만들기]를 부탁하세요. 만들어지면 이 화면에 바로 나타납니다.</div>
      ) : (
        <div className="mode-list">
          {docs.map((d) => (
            <button key={d.id} className="mode" style={{ textAlign: 'left', whiteSpace: 'normal', display: 'block' }} onClick={() => setOpen(d)}>
              <b>{d.title} 순위 발표</b>
              <span className="muted">
                {d.topN > 0 ? `${d.topN}위부터` : `${d.rows.length}개 학급 전체`} · {d.showScores ? '점수 함께 공개' : '점수 비공개'}
                {!d.complete && ' · ⚠️ 아직 확정 안 된 종목이 있을 때 만든 자료'}
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="muted small">큰 화면(TV·프로젝터)에 연결한 기기에서 여세요. 발표 화면에서 [전체화면]을 누르고, 화면 클릭이나 스페이스바로 한 학급씩 공개합니다.</p>
    </div>
  );
}
