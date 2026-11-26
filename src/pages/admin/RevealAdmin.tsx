// 관리자: 블라인드(결과 숨기기) · 공개 진행자 링크 · 최종 순위 발표 자료
import { lazy, Suspense, useMemo, useState } from 'react';
import { useAdmin } from './AdminLayout';
import { EventKey } from './RefereeAdmin';
import { useEventRanks } from './Scores';
import { useCollection, useDoc, useDocs } from '../../data/hooks';
import {
  blindOff,
  blindOn,
  isBlind,
  paths,
  PRESENTER,
  writeReveal,
  type BlindDoc,
  type BonusDoc,
  type JsonDoc,
  type RefKeysDoc,
  type RefSessionDoc,
  type ResultsDoc,
  type RevealDoc,
} from '../../data/store';
import type { TournamentConfig } from '../../config/types';
import { computeScores, rankByScope } from '../../lib/scoring';

const RevealStage = lazy(() => import('../reveal/RevealStage'));

export default function RevealAdmin() {
  const { tid, config } = useAdmin();
  if (!config || !tid) return <p>먼저 홈에서 대회를 시작하세요.</p>;
  return (
    <>
      <h1>순위 발표</h1>
      <p className="page-intro">폐회식에서 순위를 한 반씩 멋지게 발표해요. 순서: ① 대회 후반에 결과 숨기기 → ② 발표 화면 만들기 → ③ 발표 선생님께 링크 보내기</p>
      <BlindSection tid={tid} config={config} />
      <PresenterSection tid={tid} />
      <PackagesSection tid={tid} config={config} />
    </>
  );
}

// ---------------- 블라인드 ----------------

function BlindSection({ tid, config }: { tid: string; config: TournamentConfig }) {
  const bl = useDoc<BlindDoc>(paths.blind(tid));
  const hiddenPaths = useMemo(() => config.events.map((e) => paths.hidden(tid, e.id)), [tid, config]);
  const hidden = useDocs<ResultsDoc>(hiddenPaths);
  const [busy, setBusy] = useState(false);
  const on = config.events.filter((e) => isBlind(bl.data, e.id));
  const off = config.events.filter((e) => !isBlind(bl.data, e.id));
  const hiddenCount = (id: string) => {
    const d = hidden.data[paths.hidden(tid, id)];
    return Object.keys(d?.r ?? {}).length + Object.keys(d?.rec ?? {}).length;
  };
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } catch (e: any) {
      alert('실패: ' + e.message + '\n(보안 규칙이 최신인지 학교 연결 화면에서 확인하세요)');
    } finally {
      setBusy(false);
    }
  };
  const doOn = (evs: typeof config.events) =>
    confirm(`결과를 숨길까요? (${evs.map((e) => e.name).join(', ')})\n\n지금부터 넣는 결과는 학생 화면에 안 나와요. 심판은 평소처럼 넣으면 돼요.`) &&
    run(() => blindOn(tid, evs));
  const doOff = (evs: typeof config.events) =>
    confirm(`숨긴 결과를 보여 줄까요? (${evs.map((e) => e.name).join(', ')})\n\n숨겨 둔 결과가 학생 화면에 한꺼번에 나타나요.`) &&
    run(() => blindOff(tid, evs.map((e) => ({ id: e.id, name: e.name, hidden: hidden.data[paths.hidden(tid, e.id)] ?? null }))));

  return (
    <div className="card stack">
      <h2>① 🙈 결과 숨기기 (대회 후반)</h2>
      <p className="small" style={{ margin: 0 }}>
        켜면 그다음 경기 결과가 학생 화면에 안 나와요. 그래서 학생들이 순위를 미리 알 수 없어요. 심판 입력과 점수 계산은 평소처럼 돼요.
      </p>
      {bl.loading || hidden.loading ? (
        <p className="muted">불러오는 중…</p>
      ) : (
        <>
          {config.events.map((e) => {
            const b = isBlind(bl.data, e.id);
            return (
              <div key={e.id} className="row item" style={{ marginBottom: 0 }}>
                <b className="grow">{e.name}</b>
                {b ? <span className="badge badge-warn">🙈 숨기는 중 · {hiddenCount(e.id)}건</span> : <span className="badge badge-ok">보이는 중</span>}
                {b ? (
                  <button className="btn-sm" disabled={busy} onClick={() => doOff([e])}>결과 보여 주기</button>
                ) : (
                  <button className="btn-sm" disabled={busy} onClick={() => doOn([e])}>숨기기</button>
                )}
              </div>
            );
          })}
          <div className="row">
            <button disabled={busy || off.length === 0} onClick={() => doOn(off)}>모든 종목 숨기기</button>
            <button disabled={busy || on.length === 0} onClick={() => doOff(on)}>모든 종목 보여 주기</button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------- 공개 진행자 ----------------

function PresenterSection({ tid }: { tid: string }) {
  const keys = useDoc<RefKeysDoc>(paths.refKeys(tid));
  const sessions = useCollection<RefSessionDoc>(paths.refSessions(tid));
  const k = keys.data?.keys?.[PRESENTER];
  return (
    <>
      <h2 style={{ marginTop: 20 }}>③ 🎤 발표 선생님께 링크 보내기</h2>
      <p className="small">폐회식 사회 선생님께 링크와 비밀번호(PIN)를 보내세요. 큰 화면에 연결한 기기에서 열면 ②에서 만든 발표 화면이 나와요. 발표 선생님은 결과를 고칠 수 없어요.</p>
      {keys.loading ? (
        <p className="muted">불러오는 중…</p>
      ) : (
        <EventKey tid={tid} ev={{ id: PRESENTER, name: '순위 발표' }} k={k} who="발표 선생님" linkPath={(token) => `/reveal/${token}`}
          names={sessions.docs.filter((s) => s.ev === PRESENTER && k?.token === s.token && k?.pin === s.pin).map((s) => s.name)} />
      )}
    </>
  );
}

// ---------------- 발표 자료 ----------------

function PackagesSection({ tid, config }: { tid: string; config: TournamentConfig }) {
  const evPaths = useMemo(
    () => config.events.flatMap((e) => [paths.bracket(tid, e.id), paths.results(tid, e.id), paths.hidden(tid, e.id)]),
    [tid, config],
  );
  const docs = useDocs<JsonDoc | ResultsDoc>(evPaths);
  const bonusDoc = useDoc<BonusDoc>(paths.bonus(tid));
  const existing = useCollection<RevealDoc>(paths.revealCol(tid));
  const { ranksByEvent, status } = useEventRanks(tid, config, docs.data);
  const rows = useMemo(
    () => computeScores(config, ranksByEvent, bonusDoc.data?.v ?? {}, config.scoring.sharedRankPoints ?? 'same'),
    [config, ranksByEvent, bonusDoc.data],
  );
  const complete = status.every((s) => s.total > 0 && s.decided === s.total);
  const grades = config.grades.map((g) => g.grade).sort((a, b) => a - b);
  const scopes: { scope: string; title: string; grade: number | null }[] = [
    ...(grades.length > 1 ? [{ scope: 'all', title: '전교', grade: null }] : []),
    ...grades.map((g) => ({ scope: `g${g}`, title: `${g}학년`, grade: g })),
  ];
  const [preview, setPreview] = useState<RevealDoc | null>(null);

  if (docs.loading || bonusDoc.loading || existing.loading) return <p className="muted">불러오는 중…</p>;

  return (
    <>
      <h2 style={{ marginTop: 20 }}>② 🏆 발표 화면 만들기</h2>
      <p className="small">
        지금 순위로 발표 화면을 만들어요. [▶ 미리보기]로 먼저 볼 수 있어요. 결과가 바뀌면 다시 만들어 주세요.
        {!complete && <b> ⚠️ 아직 안 끝난 종목이 있어요.</b>}
      </p>
      {scopes.map((s) => {
        const ranked = rankByScope(rows, config, s.grade);
        const cur = existing.docs.find((d) => d.scope === s.scope);
        const changed = cur && JSON.stringify(cur.rows.map((r) => [r.id, r.rank])) !== JSON.stringify(ranked.map((r) => [r.id, r.rank]));
        return (
          <PackageCard key={s.scope} title={s.title} cur={cur} changed={!!changed} onPreview={setPreview}
            onMake={(showScores, topN) =>
              writeReveal(tid, {
                scope: s.scope,
                title: s.title,
                rows: ranked.map((r) => ({ rank: r.rank, id: r.id, shared: r.shared, ...(showScores ? { total: r.total } : {}) })),
                showScores,
                topN,
                complete,
                at: Date.now(),
              })
            } />
        );
      })}
      {preview && (
        <Suspense fallback={null}>
          <RevealStage doc={preview} title={`${preview.title} 최종 순위 (미리보기)`} onExit={() => setPreview(null)} />
        </Suspense>
      )}
    </>
  );
}

function PackageCard({ title, cur, changed, onMake, onPreview }: {
  title: string;
  cur?: RevealDoc;
  changed: boolean;
  onMake: (showScores: boolean, topN: number) => Promise<void>;
  onPreview: (d: RevealDoc) => void;
}) {
  const [showScores, setShowScores] = useState(cur?.showScores ?? false);
  const [topN, setTopN] = useState(cur?.topN ?? 0);
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      await onMake(showScores, topN);
    } catch (e: any) {
      alert('실패: ' + e.message + '\n(보안 규칙이 최신인지 학교 연결 화면에서 확인하세요)');
    } finally {
      setBusy(false);
    }
  };
  const at = cur ? new Date(cur.at) : null;
  return (
    <div className="card stack">
      <div className="row">
        <h3 className="grow" style={{ margin: 0 }}>{title} 순위 발표</h3>
        {cur ? (
          changed ? <span className="badge badge-warn">순위가 바뀌었어요 → 다시 만들기</span> : <span className="badge badge-ok">준비 완료</span>
        ) : (
          <span className="badge">아직 안 만듦</span>
        )}
      </div>
      <div className="row">
        <label className="row" style={{ fontWeight: 400, margin: 0 }}>
          <input type="checkbox" checked={showScores} onChange={(e) => setShowScores(e.target.checked)} /> 총점도 같이 보여 주기
        </label>
        <select style={{ width: 'auto' }} value={topN} onChange={(e) => setTopN(Number(e.target.value))} aria-label={`${title} 발표 범위`}>
          <option value={0}>모든 반 발표</option>
          <option value={3}>3위부터 1위까지</option>
          <option value={5}>5위부터 1위까지</option>
          <option value={10}>10위부터 1위까지</option>
        </select>
      </div>
      <div className="row">
        <button className="btn-primary" disabled={busy} onClick={make}>{cur ? '다시 만들기' : '발표 화면 만들기'}</button>
        {cur && <button onClick={() => onPreview(cur)}>▶ 미리보기</button>}
        {at && <span className="muted small">{at.getHours()}:{String(at.getMinutes()).padStart(2, '0')}에 만듦{!cur!.complete && ' · 안 끝난 종목 있음'}</span>}
      </div>
    </div>
  );
}
