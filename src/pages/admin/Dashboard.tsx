import { Link, useNavigate } from 'react-router-dom';
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
        {config.date} · {allClasses(config).length}개 반 · 종목 {config.events.length}개
      </p>

      <div className="card">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>지금 하는 순서</h2>
          <span className={`badge ${p.delayMin > 5 ? 'badge-danger' : p.delayMin > 0 ? 'badge-warn' : 'badge-ok'}`}>{delayLabel(p.delayMin)}</span>
        </div>
        <p style={{ margin: '10px 0 2px', fontSize: 18 }}><b>{p.current?.title ?? '모든 순서가 끝났어요 🎉'}</b></p>
        <p className="muted" style={{ margin: 0 }}>다음: {p.next?.title ?? '없음'} · {p.doneCount}/{p.total} 끝남</p>
      </div>

      <Step title="1. 대회 준비" hint="대회 전에 한 번만 하면 돼요.">
        <StepLink to="/admin/setup" icon="⚙️" title="우리 학교 대회 정보 넣기" desc="반 수, 종목, 점수, 진행표를 넣어요. 계획서를 붙여넣으면 쉬워요." />
        <StepLink to="/admin/bracket" icon="🏆" title="경기 대진표 만들기" desc="종목마다 누가 누구와 경기할지 정해요." />
        <StepLink to="/admin/referee" icon="🧑‍⚖️" title="심판 선생님께 링크 보내기" desc="심판 선생님이 폰으로 경기 결과를 넣을 수 있어요." />
        <StepLink to="/admin/backup" icon="🎭" title="연습해 보기 (선택)" desc="진짜 대회에 영향 없이 미리 해 볼 수 있어요." />
      </Step>

      <Step title="2. 대회 날" hint="이 화면들을 열어 두고 쓰세요.">
        <StepLink to="/admin/scenario" icon="⏱" title="진행표" desc="순서가 끝날 때마다 [완료]를 눌러요. 전광판이 자동으로 바뀌어요." />
        <StepLink to="/admin/bracket" icon="🏆" title="경기 결과 보기·고치기" desc="심판이 넣은 결과가 바로 보여요." />
        <StepLink to="/admin/scores" icon="🔒" title="점수 보기 · 응원 점수 넣기" desc="반별 총점과 순위예요. 선생님만 볼 수 있어요." />
        <a className="step-link" href="#/board" target="_blank" rel="noreferrer">
          <span className="step-icon">📺</span>
          <span className="grow"><b>전광판 띄우기 ↗</b><span>TV·프로젝터에 지금 순서를 크게 보여 줘요. 화면을 두 번 누르면 꽉 찬 화면이 돼요.</span></span>
        </a>
      </Step>

      <Step title="3. 폐회식" hint="순위를 멋지게 발표해요.">
        <StepLink to="/admin/reveal" icon="🎉" title="순위 발표 준비" desc="대회 후반엔 결과를 숨기고, 폐회식에서 한 반씩 발표해요." />
        <StepLink to="/admin/backup" icon="💾" title="결과를 파일로 저장" desc="끝나면 엑셀 파일로 받아 두세요." />
      </Step>

      <p className="muted small">
        로그인: {auth.currentUser?.email} ·{' '}
        <button className="btn-sm" onClick={() => signOut(auth)}>로그아웃</button>
      </p>
    </>
  );
}

function Step({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 20 }}>
      <h2 style={{ marginBottom: 2 }}>{title}</h2>
      <p className="muted" style={{ margin: '0 0 10px' }}>{hint}</p>
      <div className="more-list">{children}</div>
    </section>
  );
}

function StepLink({ to, icon, title, desc }: { to: string; icon: string; title: string; desc: string }) {
  return (
    <Link className="step-link" to={to}>
      <span className="step-icon">{icon}</span>
      <span className="grow"><b>{title}</b><span>{desc}</span></span>
      <span className="step-arrow">›</span>
    </Link>
  );
}

/** 대회가 아직 없을 때: 샘플 또는 JSON 파일로 시작 */
function FirstRun() {
  const nav = useNavigate();
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
      <h1>체육대회 시작하기</h1>
      <div className="card stack">
        <p>아직 대회가 없어요. 어떻게 시작할까요?</p>
        <button className="btn-primary" disabled={busy} onClick={() =>
            loadSample()
              .then((c) => {
                // 샘플 학교 이름 대신 우리 학교용 기본값으로 시작(계획서를 붙여넣으면 바뀜)
                const y = new Date().getFullYear();
                return start({ ...c, id: `${y}-sportsday`, title: `${y} 체육대회`, school: '' });
              })
              .then(() => nav('/admin/setup?tab=plan'))
          }>
          📄 우리 학교 계획서로 시작
        </button>
        <p className="muted small" style={{ margin: 0 }}>계획서의 진행표·종목을 붙여넣으면 우리 학교 대회가 만들어져요.</p>
        <button disabled={busy} onClick={() => loadSample().then(start)}>
          예시 대회로 먼저 둘러보기
        </button>
        <details>
          <summary className="small muted">저장해 둔 대회 파일(.json)이 있어요</summary>
          <label className="btn btn-sm" style={{ marginTop: 8 }}>
            파일 불러오기
            <input type="file" accept=".json,application/json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        </details>
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
