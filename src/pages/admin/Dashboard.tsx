import { Link } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { checkRules } from '../../lib/rulesVersion';
import { auth } from '../../lib/firebase';
import { useAdmin } from './AdminLayout';
import { useNow } from '../../data/hooks';
import { computeProgress } from '../../lib/scenario';
import { delayLabel } from '../../lib/time';
import { allClasses } from '../../config/derive';
import { saveConfig } from '../../data/store';
import { validateConfig } from '../../config/validate';
import type { TournamentConfig } from '../../config/types';
import { loadSample } from '../../config/sample';

export default function Dashboard() {
  const { config, done, loading } = useAdmin();
  const now = useNow(15000);

  if (loading) return <p className="muted">불러오는 중…</p>;
  if (!config) return <><RulesWarning /><FirstRun /></>;

  const p = computeProgress(config.scenario, done, now);
  return (
    <>
      <RulesWarning />
      <h1>{config.title}</h1>
      <p className="muted">
        {config.date} · 학급 {allClasses(config).length}개 · 종목 {config.events.length}개
      </p>
      <div className="card">
        <h2>진행 상황</h2>
        <p>
          <span className="badge badge-primary">현재</span> <b>{p.current?.title ?? '모든 순서 완료'}</b>
        </p>
        <p>
          <span className="badge">다음</span> {p.next?.title ?? '-'}
        </p>
        <p className="row">
          <span>
            완료 {p.doneCount}/{p.total}
          </span>
          <span className={`badge ${p.delayMin > 5 ? 'badge-danger' : p.delayMin > 0 ? 'badge-warn' : 'badge-ok'}`}>
            {delayLabel(p.delayMin)}
          </span>
        </p>
        <div className="row">
          <Link className="btn btn-primary" to="/admin/scenario">
            시나리오 진행 화면 열기
          </Link>
          <Link className="btn" to="/admin/bracket">
            대진표·경기 결과
          </Link>
        </div>
      </div>
      <div className="card muted small">
        로그인: {auth.currentUser?.email} ·{' '}
        <button className="btn-sm" onClick={() => signOut(auth)}>
          로그아웃
        </button>
      </div>
    </>
  );
}

/** 대회가 아직 없을 때: 샘플 또는 JSON 파일로 시작 */
function FirstRun() {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const start = async (cfg: TournamentConfig) => {
    const errs = validateConfig(cfg);
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    try {
      await saveConfig(cfg, null, {});
    } catch (e: any) {
      alert('저장 실패: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      start(JSON.parse(await f.text()));
    } catch {
      setErrors(['JSON 파일을 읽을 수 없습니다. 파일 형식을 확인하세요.']);
    }
  };

  return (
    <>
      <h1>대회 시작하기</h1>
      <div className="card stack">
        <p>아직 등록된 대회가 없습니다. 아래 중 하나를 고르세요.</p>
        <button className="btn-primary" disabled={busy} onClick={() => loadSample().then(start)}>
          샘플 설정으로 시작 (2학년 8학급, 종목 4개)
        </button>
        <label className="btn" style={{ marginBottom: 0 }}>
          대회 설정 JSON 파일 가져오기
          <input type="file" accept=".json,application/json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {errors.length > 0 && (
          <div className="alert alert-danger">
            설정 파일에 문제가 있습니다:
            <ul>
              {errors.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

/** 이 학교 Firebase의 보안 규칙이 예전 버전이면 경고 */
function RulesWarning() {
  const [outdated, setOutdated] = useState(false);
  useEffect(() => {
    checkRules().then((r) => setOutdated(r.status === 'outdated'));
  }, []);
  if (!outdated) return null;
  return (
    <div className="alert alert-danger">
      ⚠️ 보안 규칙 업데이트가 필요합니다. 앱이 새 기능을 쓰려면 최신 규칙이 있어야 합니다.{' '}
      <Link to="/connect">학교 연결 화면에서 규칙 복사·붙여넣기</Link>
    </div>
  );
}
