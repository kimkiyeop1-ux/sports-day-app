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
  if (!config || !tid) return <p>먼저 대시보드에서 대회를 시작하세요.</p>;
  return (
    <>
      <h1>블라인드 · 최종 공개</h1>
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
    confirm(`블라인드를 켤까요? (${evs.map((e) => e.name).join(', ')})\n\n지금부터 입력하는 결과는 공개 대진표에 나오지 않습니다. 심판은 평소처럼 입력하면 됩니다.`) &&
    run(() => blindOn(tid, evs));
  const doOff = (evs: typeof config.events) =>
    confirm(`결과를 공개할까요? (${evs.map((e) => e.name).join(', ')})\n\n숨겨 둔 결과가 공개 대진표에 한꺼번에 나타납니다.`) &&
    run(() => blindOff(tid, evs.map((e) => ({ id: e.id, name: e.name, hidden: hidden.data[paths.hidden(tid, e.id)] ?? null }))));

  return (
    <div className="card stack">
      <h2>🙈 블라인드</h2>
      <p className="muted small" style={{ margin: 0 }}>
        대회 후반에 켜면 그 뒤 경기 결과가 공개 대진표에 나오지 않아, 학생들이 총점을 미리 계산할 수 없습니다. 심판 입력과 관리자 점수 계산은 그대로 됩니다.
        숨긴 결과는 보안 규칙으로도 막혀 있어 공개 화면에 새어 나가지 않습니다.
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
                {b ? <span className="badge badge-warn">블라인드 중 · 숨긴 결과 {hiddenCount(e.id)}건</span> : <span className="badge badge-ok">공개 중</span>}
                {b ? (
                  <button className="btn-sm" disabled={busy} onClick={() => doOff([e])}>결과 공개</button>
                ) : (
                  <button className="btn-sm" disabled={busy} onClick={() => doOn([e])}>블라인드 켜기</button>
                )}
              </div>
            );
          })}
          <div className="row">
            <button disabled={busy || off.length === 0} onClick={() => doOn(off)}>모든 종목 블라인드</button>
            <button disabled={busy || on.length === 0} onClick={() => doOff(on)}>모든 종목 결과 공개</button>
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
      <h2 style={{ marginTop: 20 }}>🎤 공개 진행자(폐회식 사회 선생님)</h2>
      <p className="muted small">진행 선생님께 링크와 PIN을 보내면, 큰 화면에 연결한 기기에서 아래 '발표 자료'로 순위를 하나씩 공개할 수 있습니다. 진행자는 결과를 고칠 수 없습니다.</p>
      {keys.loading ? (
        <p className="muted">불러오는 중…</p>
      ) : (
        <EventKey tid={tid} ev={{ id: PRESENTER, name: '최종 순위 발표' }} k={k} who="공개 진행자" linkPath={(token) => `/reveal/${token}`}
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
      <h2 style={{ marginTop: 20 }}>🏆 발표 자료</h2>
      <p className="muted small">
        지금의 종합 순위를 '발표 자료'로 저장합니다. 진행자는 이 자료만 볼 수 있습니다. 결과가 바뀌면 다시 만들어 주세요.
        {!complete && <b> ⚠️ 아직 확정되지 않은 종목이 있습니다(중간 집계).</b>}
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
          changed ? <span className="badge badge-warn">자료를 만든 뒤 순위가 바뀜</span> : <span className="badge badge-ok">최신</span>
        ) : (
          <span className="badge">아직 없음</span>
        )}
      </div>
      <div className="row">
        <label className="row" style={{ fontWeight: 400, margin: 0 }}>
          <input type="checkbox" checked={showScores} onChange={(e) => setShowScores(e.target.checked)} /> 총점도 함께 공개
        </label>
        <select style={{ width: 'auto' }} value={topN} onChange={(e) => setTopN(Number(e.target.value))} aria-label={`${title} 발표 범위`}>
          <option value={0}>전체 학급 발표</option>
          <option value={3}>3위부터 1위까지</option>
          <option value={5}>5위부터 1위까지</option>
          <option value={10}>10위부터 1위까지</option>
        </select>
      </div>
      <div className="row">
        <button className="btn-primary" disabled={busy} onClick={make}>{cur ? '발표 자료 다시 만들기' : '발표 자료 만들기'}</button>
        {cur && <button onClick={() => onPreview(cur)}>▶ 미리보기</button>}
        {at && <span className="muted small">만든 시각 {at.getHours()}:{String(at.getMinutes()).padStart(2, '0')}{!cur!.complete && ' · 중간 집계'}</span>}
      </div>
    </div>
  );
}
