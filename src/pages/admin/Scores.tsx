// 관리자: 학급 총점·종합 순위, 경기 외 점수 입력, 동점 규칙 설정 (🔒 관리자 전용 — 공개 화면에 나오지 않음)
import { useMemo, useState } from 'react';
import { useAdmin } from './AdminLayout';
import { useDoc, useDocs } from '../../data/hooks';
import {
  leaguePointsOf,
  paths,
  parseJsonDoc,
  readResults,
  saveConfig,
  writeBonus,
  type BonusDoc,
  type BracketData,
  type JsonDoc,
  type ResultsDoc,
} from '../../data/store';
import type { ClassId, TournamentConfig } from '../../config/types';
import { allClasses } from '../../config/derive';
import { divisionsOf, finalRanking, resolveDivision, type FinalRank } from '../../lib/bracket';
import {
  computeScores,
  rankByScope,
  tieBreakerLabel,
  tieBreakerOptions,
  type BonusMap,
  type RankedRow,
  type SharedRankPoints,
} from '../../lib/scoring';

type Tab = 'rank' | 'bonus' | 'rules';

interface EventStatus {
  id: string;
  name: string;
  decided: number;
  total: number;
  hasBracket: boolean;
  stale: boolean;
}

export default function Scores() {
  const { tid, config, done } = useAdmin();
  const [tab, setTab] = useState<Tab>('rank');
  const evPaths = useMemo(
    () => (tid && config ? config.events.flatMap((e) => [paths.bracket(tid, e.id), paths.results(tid, e.id), paths.hidden(tid, e.id)]) : []),
    [tid, config],
  );
  const docs = useDocs<JsonDoc | ResultsDoc>(evPaths);
  const bonusDoc = useDoc<BonusDoc>(tid ? paths.bonus(tid) : null);
  if (!config || !tid) return <p>먼저 대시보드에서 대회를 시작하세요.</p>;

  return (
    <>
      <h1>점수 · 순위 🔒</h1>
      <p className="muted small">관리자만 볼 수 있습니다. 전광판·공개 대진표·심판 화면에는 총점과 순위가 나오지 않습니다.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        {([
          ['rank', '종합 순위'],
          ['bonus', '경기 외 점수'],
          ['rules', '동점 규칙'],
        ] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={`btn-sm ${tab === k ? 'btn-primary' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {docs.loading || bonusDoc.loading ? (
        <p className="muted">불러오는 중…</p>
      ) : tab === 'rank' ? (
        <RankTab tid={tid} config={config} docs={docs.data} bonus={bonusDoc.data?.v ?? {}} />
      ) : tab === 'bonus' ? (
        <BonusTab tid={tid} config={config} bonus={bonusDoc.data?.v ?? {}} />
      ) : (
        <RulesTab config={config} save={(c) => saveConfig(c, config, done)} />
      )}
    </>
  );
}

/** 종목별 최종 순위(대진단위를 모두 합침) + 진행 현황 */
export function useEventRanks(tid: string, config: TournamentConfig, docs: Record<string, unknown>) {
  return useMemo(() => {
    const ranksByEvent: Record<string, FinalRank[]> = {};
    const status: EventStatus[] = [];
    for (const ev of config.events) {
      const bracket = parseJsonDoc<BracketData>(docs[paths.bracket(tid, ev.id)] as JsonDoc | null);
      // 블라인드 중 결과(hidden)까지 합쳐서 계산 — 관리자는 실제 순위를 알아야 하므로
      const { results, records } = readResults(
        (docs[paths.results(tid, ev.id)] as ResultsDoc | null) ?? null,
        bracket,
        (docs[paths.hidden(tid, ev.id)] as ResultsDoc | null) ?? null,
      );
      const wanted = divisionsOf(ev, config);
      const list: FinalRank[] = [];
      let stale = false;
      for (const w of wanted) {
        const div = bracket?.divisions.find((d) => d.key === w.key);
        if (!div) {
          list.push(...w.entrants.map((id) => ({ id, rank: null })));
          continue;
        }
        if (div.format !== ev.format.type || [...div.entrants].sort().join() !== [...w.entrants].sort().join()) stale = true;
        const rd = resolveDivision(div, results, leaguePointsOf(ev), bracket?.groupOrder?.[div.key]);
        list.push(...finalRanking(div, rd, records[div.key] ?? {}, ev.format.rankBy));
      }
      ranksByEvent[ev.id] = list;
      status.push({
        id: ev.id,
        name: ev.name,
        decided: list.filter((r) => r.rank != null).length,
        total: list.length,
        hasBracket: !!bracket?.divisions.length,
        stale,
      });
    }
    return { ranksByEvent, status };
  }, [tid, config, docs]);
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');
}

function RankTab({ tid, config, docs, bonus }: { tid: string; config: TournamentConfig; docs: Record<string, unknown>; bonus: BonusMap }) {
  const grades = [...config.grades].map((g) => g.grade).sort((a, b) => a - b);
  const [scope, setScope] = useState<number | null>(grades.length === 1 ? grades[0] : null);
  const { ranksByEvent, status } = useEventRanks(tid, config, docs);
  const rows = useMemo(() => computeScores(config, ranksByEvent, bonus, config.scoring.sharedRankPoints ?? 'same'), [config, ranksByEvent, bonus]);
  const ranked: RankedRow[] = rankByScope(rows, config, scope);
  const events = config.events.filter((e) => scope == null || e.grades.includes(scope));
  const complete = status.every((s) => s.total > 0 && s.decided === s.total);
  const ownBonus = config.scoring.bonusCategories;

  return (
    <>
      <div className="card">
        <h3>종목별 확정 현황</h3>
        <div className="row">
          {status.map((s) => (
            <span key={s.id} className={`chip ${s.decided === s.total && s.total ? 'chip-ok' : ''}`}>
              {s.name} · {!s.hasBracket ? '대진표 없음' : `${s.decided}/${s.total}`}
              {s.decided === s.total && s.total ? ' ✅' : ''}
              {s.stale ? ' ⚠️설정 바뀜' : ''}
            </span>
          ))}
        </div>
        {!complete && <p className="muted small" style={{ marginBottom: 0 }}>아직 순위가 확정되지 않은 종목이 있어 <b>중간 집계</b>입니다. 확정 안 된 종목 점수는 0점으로 계산합니다.</p>}
      </div>

      {grades.length > 1 && (
        <div className="row" style={{ marginBottom: 12 }}>
          <button className={`btn-sm ${scope == null ? 'btn-primary' : ''}`} onClick={() => setScope(null)}>전교</button>
          {grades.map((g) => (
            <button key={g} className={`btn-sm ${scope === g ? 'btn-primary' : ''}`} onClick={() => setScope(g)}>{g}학년</button>
          ))}
        </div>
      )}

      <div className="card">
        <h3>{scope == null ? '전교' : `${scope}학년`} 종합 순위 {complete ? <span className="badge badge-ok">최종</span> : <span className="badge badge-warn">중간 집계</span>}</h3>
        <div className="table-wrap">
          <table className="tbl tbl-score">
            <thead>
              <tr>
                <th>순위</th>
                <th>학급</th>
                {events.map((e) => <th key={e.id}>{e.name}</th>)}
                {ownBonus.length > 0 && <th>경기 외</th>}
                <th>총점</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r) => (
                <tr key={r.id} className={r.rank === 1 ? 'row-gold' : ''}>
                  <td>
                    <b>{r.rank}</b>
                    {r.shared && <span className="tied" title="동점 규칙으로도 갈리지 않음"> 공동</span>}
                  </td>
                  <td><b>{r.id}</b></td>
                  {events.map((e) => {
                    const s = r.events[e.id];
                    return (
                      <td key={e.id}>
                        {s ? (
                          <>
                            {fmt(s.points)}
                            <div className="muted tiny">{s.rank != null ? `${s.rank}위` : '미정'}</div>
                          </>
                        ) : '-'}
                      </td>
                    );
                  })}
                  {ownBonus.length > 0 && <td>{fmt(r.bonusTotal)}</td>}
                  <td>
                    <b>{fmt(r.total)}</b>
                    {r.decidedBy && <div className="muted tiny" title={tieBreakerLabel(config, r.decidedBy)}>동점→{shortTb(config, r.decidedBy)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          종목 점수 = (순위 점수 + 참가점) × 가중치 · 공동 순위 점수: {config.scoring.sharedRankPoints === 'average' ? '자리 평균' : '같은 점수'} · 동점 규칙:{' '}
          {config.scoring.tieBreakers.length ? config.scoring.tieBreakers.map((k) => tieBreakerLabel(config, k)).join(' → ') : '없음(공동 순위)'}
        </p>
      </div>
    </>
  );
}

function shortTb(config: TournamentConfig, key: string): string {
  if (key === 'mostFirstPlaces') return '1위 횟수';
  if (key === 'mostSecondPlaces') return '2위 횟수';
  if (key === 'mostThirdPlaces') return '3위 횟수';
  if (key === 'eventTotal') return '경기 점수';
  if (key.startsWith('event:')) return config.events.find((e) => e.id === key.slice(6))?.name ?? key;
  if (key.startsWith('bonus:')) return config.scoring.bonusCategories.find((c) => c.id === key.slice(6))?.name ?? key;
  return key;
}

// ---------------- 경기 외 점수 ----------------

function BonusTab({ tid, config, bonus }: { tid: string; config: TournamentConfig; bonus: BonusMap }) {
  if (!config.scoring.bonusCategories.length)
    return <div className="card muted">경기 외 점수 항목이 없습니다. [대회 설정 → 기본·학급 → 경기 외 점수 항목]에서 추가하세요.</div>;
  return (
    <>
      {config.scoring.bonusCategories.map((cat) => (
        <BonusCard key={cat.id} tid={tid} config={config} cat={cat} values={bonus[cat.id] ?? {}} />
      ))}
    </>
  );
}

function BonusCard({ tid, config, cat, values }: {
  tid: string;
  config: TournamentConfig;
  cat: { id: string; name: string; negative?: boolean };
  values: Record<ClassId, number>;
}) {
  const classes = allClasses(config);
  const toText = (v: Record<ClassId, number>) => Object.fromEntries(classes.map((c) => [c, v[c] != null && v[c] !== 0 ? String(v[c]) : '']));
  const [text, setText] = useState<Record<ClassId, string>>(() => toText(values));
  const server = JSON.stringify(values);
  const [seen, setSeen] = useState(server);
  if (seen !== server) {
    setSeen(server);
    setText(toText(values));
  }
  const parsed: Record<ClassId, number> = {};
  const bad: string[] = [];
  for (const [c, v] of Object.entries(text)) {
    if (v.trim() === '') continue;
    const n = Number(v);
    if (Number.isNaN(n) || n < 0) bad.push(c);
    else if (n !== 0) parsed[c] = n;
  }
  const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v));
  const dirty = JSON.stringify(parsed) !== JSON.stringify(clean);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await writeBonus(tid, cat, values, parsed);
    } catch (e: any) {
      alert('저장 실패: ' + e.message);
    } finally {
      setBusy(false);
    }
  };
  const byGrade = config.grades.map((g) => g.grade).sort((a, b) => a - b);
  return (
    <div className="card stack">
      <div className="row">
        <h3 className="grow" style={{ margin: 0 }}>{cat.name} {cat.negative && <span className="badge badge-danger">감점</span>}</h3>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {cat.negative ? '입력한 점수만큼 총점에서 뺍니다(숫자는 양수로 입력).' : '입력한 점수만큼 총점에 더합니다.'} 비워 두면 0점입니다.
      </p>
      {byGrade.map((g) => (
        <div key={g} className="seat-grid">
          {classes.filter((c) => c.startsWith(`${g}-`)).map((c) => (
            <label key={c} className="row" style={{ fontWeight: 400, margin: 0 }}>
              <b style={{ width: 44 }}>{c}</b>
              <input inputMode="decimal" value={text[c] ?? ''} onChange={(e) => setText({ ...text, [c]: e.target.value })} aria-label={`${c} ${cat.name}`} />
            </label>
          ))}
        </div>
      ))}
      {bad.length > 0 && <div className="alert alert-danger">0 이상의 숫자만 넣을 수 있습니다: {bad.join(', ')}</div>}
      <button className="btn-primary" disabled={!dirty || bad.length > 0 || busy} onClick={save}>{cat.name} 저장</button>
    </div>
  );
}

// ---------------- 동점 규칙 ----------------

function RulesTab({ config, save }: { config: TournamentConfig; save: (c: TournamentConfig) => Promise<void> }) {
  const [list, setList] = useState<string[]>(config.scoring.tieBreakers);
  const [shared, setShared] = useState<SharedRankPoints>(config.scoring.sharedRankPoints ?? 'same');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const options = tieBreakerOptions(config).filter((o) => !list.includes(o.key));
  const dirty = JSON.stringify(list) !== JSON.stringify(config.scoring.tieBreakers) || shared !== (config.scoring.sharedRankPoints ?? 'same');
  const mv = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const a = [...list];
    [a[i], a[j]] = [a[j], a[i]];
    setList(a);
  };
  const submit = async () => {
    setBusy(true);
    try {
      await save({ ...config, scoring: { ...config.scoring, tieBreakers: list, sharedRankPoints: shared } });
      setMsg('저장했습니다. 종합 순위에 바로 반영됩니다.');
      setTimeout(() => setMsg(null), 3000);
    } catch (e: any) {
      alert('저장 실패: ' + e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="card stack">
        <h3>총점이 같을 때 (위에서부터 차례로 적용)</h3>
        {list.length === 0 && <p className="muted small">규칙이 없으면 총점이 같은 학급은 공동 순위가 됩니다.</p>}
        {list.map((k, i) => (
          <div key={k} className="row item" style={{ marginBottom: 0 }}>
            <b style={{ width: 24 }}>{i + 1}</b>
            <span className="grow">{tieBreakerLabel(config, k)}</span>
            <button className="btn-sm btn-icon" onClick={() => mv(i, -1)} aria-label="위로">▲</button>
            <button className="btn-sm btn-icon" onClick={() => mv(i, 1)} aria-label="아래로">▼</button>
            <button className="btn-sm btn-danger" onClick={() => setList(list.filter((x) => x !== k))}>빼기</button>
          </div>
        ))}
        {options.length > 0 && (
          <select value="" onChange={(e) => e.target.value && setList([...list, e.target.value])} aria-label="동점 규칙 추가">
            <option value="">+ 규칙 추가…</option>
            {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        )}
        <p className="muted small" style={{ margin: 0 }}>모든 규칙으로도 같으면 공동 순위가 됩니다(예: 공동 2위 다음은 4위).</p>
      </div>
      <div className="card stack">
        <h3>종목에서 공동 순위일 때 받는 점수</h3>
        <label className="row" style={{ fontWeight: 400 }}>
          <input type="radio" checked={shared === 'same'} onChange={() => setShared('same')} />
          같은 점수 — 공동 3위 2학급이면 둘 다 3위 점수
        </label>
        <label className="row" style={{ fontWeight: 400 }}>
          <input type="radio" checked={shared === 'average'} onChange={() => setShared('average')} />
          자리 평균 — 공동 3위 2학급이면 (3위 점수 + 4위 점수) ÷ 2
        </label>
        <p className="muted small" style={{ margin: 0 }}>예: 토너먼트 8강에서 진 4학급은 모두 '공동 5위'입니다.</p>
      </div>
      {msg && <div className="alert alert-ok">{msg}</div>}
      <button className="btn-primary" style={{ width: '100%' }} disabled={!dirty || busy} onClick={submit}>저장</button>
    </>
  );
}

