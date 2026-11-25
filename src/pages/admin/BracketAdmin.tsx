// 관리자: 대진표 생성·자리 수정(추첨 결과 입력)·경기 결과 입력
import { useMemo, useRef, useState } from 'react';
import { useAdmin } from './AdminLayout';
import { SyncBadge } from './AdminLayout';
import type { ClassId, EventConfig, TournamentConfig } from '../../config/types';
import { FORMAT_LABELS, matchRuleLabel } from '../../config/derive';
import { useJsonDoc } from '../../data/hooks';
import { emptyBracket, leaguePointsOf, paths, saveBracket, type BracketData } from '../../data/store';
import {
  buildMatches,
  checkResult,
  createDivision,
  divisionsOf,
  finalRanking,
  groupName,
  hasResult,
  rankByRecords,
  resolveDivision,
  setsWon,
  shuffle,
  slotText,
  type Division,
  type MatchResult,
  type ResolvedDivision,
  type ResolvedMatch,
  type Slot,
} from '../../lib/bracket';
import { GroupsView, HeatsView, KnockoutView, whoText } from '../bracket/BracketView';

export default function BracketAdmin() {
  const { tid, config } = useAdmin();
  const [evId, setEvId] = useState<string | null>(null);
  if (!config || !tid) return <p>먼저 대시보드에서 대회를 시작하세요.</p>;
  const ev = config.events.find((e) => e.id === evId) ?? config.events[0];
  return (
    <>
      <h1>대진표 · 경기 결과</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        {config.events.map((e) => (
          <button key={e.id} className={`btn-sm ${e.id === ev?.id ? 'btn-primary' : ''}`} onClick={() => setEvId(e.id)}>
            {e.name}
          </button>
        ))}
      </div>
      {ev ? <EventBracket key={ev.id} tid={tid} cfg={config} ev={ev} /> : <p>종목이 없습니다. 대회 설정에서 종목을 추가하세요.</p>}
    </>
  );
}

/** 대진단위 key로 시작하는 결과만 지운다 */
function withoutDiv<T>(obj: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith(key + '-')));
}

function EventBracket({ tid, cfg, ev }: { tid: string; cfg: TournamentConfig; ev: EventConfig }) {
  const s = useJsonDoc<BracketData>(paths.bracket(tid, ev.id));
  const data = s.data ?? emptyBracket(ev.id);
  const wanted = divisionsOf(ev, cfg);

  // 빠르게 연달아 저장해도 앞의 변경이 덮어써지지 않도록 '가장 최근 값'에 변경을 적용한다
  const latest = useRef<{ from: BracketData | null; value: BracketData }>({ from: null, value: data });
  if (latest.current.from !== s.data) latest.current = { from: s.data, value: data };
  const save: SaveFn = (update, action, target, before, after) => {
    const next = update(latest.current.value);
    latest.current.value = next;
    return saveBracket(tid, ev, next, { action, target, before, after }).catch((e) => alert('저장 실패: ' + e.message));
  };

  if (s.loading) return <p className="muted">불러오는 중…</p>;

  return (
    <>
      <div className="row muted small" style={{ marginBottom: 8 }}>
        <span className="badge">{FORMAT_LABELS[ev.format.type]}</span>
        <span className="badge">{matchRuleLabel(ev)}</span>
        {ev.location && <span>{ev.location}</span>}
        <span className="grow" />
        <SyncBadge pending={s.pending} />
      </div>
      {wanted.map((w) => {
        const div = data.divisions.find((d) => d.key === w.key);
        const generate = (draw: boolean) => {
          const nd = createDivision(ev, w.key, w.title, draw ? shuffle(w.entrants) : w.entrants);
          const next = (d0: BracketData): BracketData => ({
            ...d0,
            divisions: [...d0.divisions.filter((d) => d.key !== w.key), nd].sort((a, b) => a.key.localeCompare(b.key)),
            results: withoutDiv(d0.results, w.key),
            records: { ...d0.records, [w.key]: {} },
            groupOrder: { ...d0.groupOrder, [w.key]: {} },
          });
          save(next, div ? '대진표 다시 만들기' : '대진표 만들기', w.title, div ? div.entrants : null, { draw, entrants: nd.entrants });
        };
        if (!div) return <CreateCard key={w.key} title={w.title} count={w.entrants.length} multi={wanted.length > 1} onCreate={generate} />;
        return <DivisionPanel key={w.key} ev={ev} div={div} data={data} entrants={w.entrants} multi={wanted.length > 1} save={save} regenerate={generate} />;
      })}
    </>
  );
}

function CreateCard({ title, count, multi, onCreate }: { title: string; count: number; multi: boolean; onCreate: (draw: boolean) => void }) {
  const [draw, setDraw] = useState(true);
  return (
    <div className="card stack">
      <h2>{multi ? `${title} 대진표` : '대진표'} 만들기</h2>
      <p className="muted small">참가 학급 {count}개. 만든 뒤에 [자리 수정]으로 실제 추첨 결과를 넣을 수 있습니다.</p>
      <label className="row" style={{ fontWeight: 400 }}>
        <input type="radio" checked={draw} onChange={() => setDraw(true)} /> 무작위 추첨으로 자리 정하기
      </label>
      <label className="row" style={{ fontWeight: 400 }}>
        <input type="radio" checked={!draw} onChange={() => setDraw(false)} /> 학급 번호 순서대로(뒤에서 직접 수정)
      </label>
      <button className="btn-primary" onClick={() => onCreate(draw)} disabled={count < 2}>
        대진표 만들기
      </button>
    </div>
  );
}

type SaveFn = (update: (d: BracketData) => BracketData, action: string, target: string, before: unknown, after: unknown) => Promise<void>;

function DivisionPanel({ ev, div, data, entrants, multi, save, regenerate }: {
  ev: EventConfig;
  div: Division;
  data: BracketData;
  entrants: ClassId[];
  multi: boolean;
  save: SaveFn;
  regenerate: (draw: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState<ResolvedMatch | null>(null);
  const lp = leaguePointsOf(ev);
  const order = data.groupOrder[div.key] ?? {};
  const rd = useMemo(() => resolveDivision(div, data.results, lp, order), [div, data.results, order]); // eslint-disable-line react-hooks/exhaustive-deps
  const records = data.records[div.key] ?? {};
  const resultCount = Object.keys(data.results).filter((k) => k.startsWith(div.key + '-') && hasResult(data.results[k])).length
    + Object.keys(records).length;

  // 대회 설정이 바뀌어 대진표와 맞지 않는지 확인
  const stale =
    div.format !== ev.format.type ||
    [...div.entrants].sort().join() !== [...entrants].sort().join() ||
    (div.format !== 'ranking' && div.thirdPlace !== !!ev.format.thirdPlaceMatch);

  const updateDiv = (nd: Division, action: string, before: unknown, after: unknown) => {
    const next = (d0: BracketData): BracketData => ({
      ...d0,
      divisions: d0.divisions.map((d) => (d.key === div.key ? nd : d)),
      results: withoutDiv(d0.results, div.key),
      records: { ...d0.records, [div.key]: div.format === 'ranking' ? (d0.records[div.key] ?? {}) : {} },
      groupOrder: { ...d0.groupOrder, [div.key]: {} },
    });
    return save(next, action, div.title, before, after);
  };

  const askRegenerate = () => {
    const warn = resultCount ? `\n\n⚠️ 이미 입력된 결과 ${resultCount}개가 모두 지워집니다.` : '';
    const draw = confirm(`대진표를 새로 만듭니다.${warn}\n\n[확인] 무작위 추첨으로 만들기\n[취소] 그만두기`);
    if (draw) regenerate(true);
  };

  return (
    <div className="division">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 className="grow" style={{ margin: 0 }}>{multi ? `${div.title}` : '대진표'}</h2>
        {div.format !== 'round_robin' && (
          <button className="btn-sm" onClick={() => setEditing(!editing)}>{editing ? '수정 닫기' : '✏️ 자리 수정(추첨 결과 입력)'}</button>
        )}
        <button className="btn-sm btn-danger" onClick={askRegenerate}>다시 만들기</button>
      </div>
      {stale && (
        <div className="alert alert-warn">
          대회 설정(경기 방식·학급 수·3·4위전)이 바뀌어 지금 대진표와 맞지 않습니다. [다시 만들기]를 눌러 주세요.
        </div>
      )}

      {editing ? (
        <SeatEditor div={div} resultCount={resultCount} onCancel={() => setEditing(false)}
          onSave={(nd) => {
            updateDiv(nd, '자리 수정(추첨 결과)', { groups: div.groups, koSlots: div.koSlots, heats: div.heats }, { groups: nd.groups, koSlots: nd.koSlots, heats: nd.heats });
            setEditing(false);
          }} />
      ) : div.format === 'ranking' ? (
        <RecordEditor ev={ev} div={div} records={records}
          onSave={(rec) => save((d0) => ({ ...d0, records: { ...d0.records, [div.key]: rec } }), '기록 입력', div.title, records, rec)} />
      ) : (
        <>
          {div.groups.length > 0 && (
            <GroupsView div={div} rd={rd} onMatch={setOpen}
              extra={(g) => (
                <TieOrder rd={rd} g={g} manual={!!order[String(g)]}
                  onSave={(ids) => save((d0) => ({ ...d0, groupOrder: { ...d0.groupOrder, [div.key]: { ...(d0.groupOrder[div.key] ?? {}), [String(g)]: ids } } }),
                    '조 순위 직접 지정', `${div.title} ${groupName(g)}조`, rd.standings[g].rows.map((r) => r.id), ids)}
                  onReset={() => {
                    save((d0) => {
                      const { [String(g)]: _drop, ...rest } = d0.groupOrder[div.key] ?? {};
                      return { ...d0, groupOrder: { ...d0.groupOrder, [div.key]: rest } };
                    }, '조 순위 직접 지정 취소', `${div.title} ${groupName(g)}조`, order[String(g)], null);
                  }} />
              )} />
          )}
          <KnockoutView div={div} rd={rd} onMatch={setOpen} />
        </>
      )}

      {div.format === 'ranking' && !editing && <HeatsView div={div} records={records} rankMode={(ev.format.rankBy ?? 'rank') === 'rank'} />}
      <FinalRankCard div={div} rd={rd} records={records} ev={ev} />

      {open && (
        <ResultEditor ev={ev} m={rd.byId[open.id] ?? open} rd={rd} prev={data.results[open.id]} onClose={() => setOpen(null)}
          onSave={(r, action) => {
            const m = rd.byId[open.id];
            const id = open.id;
            save((d0) => {
              const results = { ...d0.results };
              if (r) results[id] = r;
              else delete results[id];
              return { ...d0, results };
            }, action, `${div.title} ${m.label} (${whoText(m.sideA)} vs ${whoText(m.sideB)})`, data.results[open.id] ?? null, r);
            setOpen(null);
          }} />
      )}
    </div>
  );
}

// ---------------- 자리 수정(추첨 결과 입력) ----------------

function SeatEditor({ div, resultCount, onSave, onCancel }: { div: Division; resultCount: number; onSave: (d: Division) => void; onCancel: () => void }) {
  const [slots, setSlots] = useState<Slot[]>(div.koSlots);
  const [groupOf, setGroupOf] = useState<Record<ClassId, number>>(() =>
    Object.fromEntries(div.groups.flatMap((g, i) => g.map((c) => [c, i]))));
  const [heatOf, setHeatOf] = useState<Record<ClassId, number>>(() =>
    Object.fromEntries(div.heats.flatMap((h, i) => h.map((c) => [c, i]))));
  const [heatCount, setHeatCount] = useState(Math.max(1, div.heats.length));

  const isSE = div.format === 'single_elim';
  const isGK = div.format === 'groups_knockout';
  const isRank = div.format === 'ranking';
  const groupCount = div.groups.length;
  const advance = Math.max(1, ...div.koSlots.map((s) => (s.t === 'grp' ? s.r : 1)));

  // 선택지
  const slotKey = (s: Slot) => JSON.stringify(s);
  const options: Slot[] = isSE
    ? [...div.entrants.map((id) => ({ t: 'class', id }) as Slot), { t: 'bye' }]
    : [...Array.from({ length: advance }, (_, r) => Array.from({ length: groupCount }, (_, g) => ({ t: 'grp', g, r: r + 1 }) as Slot)).flat(), { t: 'bye' }];

  // 검사
  const errors: string[] = [];
  if (isSE || isGK) {
    const used = slots.filter((s) => s.t !== 'bye').map(slotKey);
    const dup = used.filter((k, i) => used.indexOf(k) !== i);
    if (dup.length) errors.push(`같은 자리가 두 번 들어 있습니다: ${[...new Set(dup)].map((k) => slotText(JSON.parse(k), (x) => x)).join(', ')}`);
    const missing = options.filter((o) => o.t !== 'bye' && !used.includes(slotKey(o)));
    if (missing.length) errors.push(`빠진 ${isSE ? '학급' : '자리'}: ${missing.map((o) => slotText(o, (x) => x)).join(', ')}`);
    for (let k = 0; k < slots.length; k += 2)
      if (slots[k].t === 'bye' && slots[k + 1].t === 'bye') errors.push(`${k / 2 + 1}경기는 양쪽이 모두 부전승입니다.`);
  }
  if (isGK) {
    for (let g = 0; g < groupCount; g++)
      if (!div.entrants.some((c) => groupOf[c] === g)) errors.push(`${groupName(g)}조에 학급이 없습니다.`);
  }

  const save = () => {
    if (errors.length) return;
    if (resultCount && !confirm(`자리를 바꾸면 이미 입력된 결과 ${resultCount}개가 지워집니다. 계속할까요?`)) return;
    const nd: Omit<Division, 'matches'> = { ...div };
    if (isSE || isGK) nd.koSlots = slots;
    if (isGK) nd.groups = Array.from({ length: groupCount }, (_, g) => div.entrants.filter((c) => groupOf[c] === g));
    if (isRank) nd.heats = Array.from({ length: heatCount }, (_, h) => div.entrants.filter((c) => (heatOf[c] ?? 0) === h)).filter((h) => h.length);
    onSave({ ...nd, matches: buildMatches(nd) } as Division);
  };

  const slotSelect = (i: number) => (
    <select value={slotKey(slots[i])} onChange={(e) => setSlots(slots.map((s, j) => (j === i ? JSON.parse(e.target.value) : s)))}>
      {options.map((o) => <option key={slotKey(o)} value={slotKey(o)}>{slotText(o, (x) => x)}</option>)}
    </select>
  );

  return (
    <div className="card stack">
      <h3>자리 수정 (추첨 결과 입력)</h3>
      {isGK && (
        <>
          <p className="muted small">① 각 학급의 조를 고르세요.</p>
          <div className="seat-grid">
            {div.entrants.map((c) => (
              <label key={c} className="row" style={{ fontWeight: 400, margin: 0 }}>
                <b style={{ width: 44 }}>{c}</b>
                <select value={groupOf[c] ?? 0} onChange={(e) => setGroupOf({ ...groupOf, [c]: Number(e.target.value) })}>
                  {Array.from({ length: groupCount }, (_, g) => <option key={g} value={g}>{groupName(g)}조</option>)}
                </select>
              </label>
            ))}
          </div>
          <p className="muted small">② 본선 토너먼트에서 몇 조 몇 위가 누구와 만나는지 정하세요.</p>
        </>
      )}
      {(isSE || isGK) && (
        <>
          {isSE && <p className="muted small">추첨 결과대로 1라운드 대진의 양쪽 학급을 고르세요. 빈 자리는 '부전승'입니다.</p>}
          {Array.from({ length: slots.length / 2 }, (_, k) => (
            <div key={k} className="row">
              <span className="small" style={{ width: 52 }}>{k + 1}경기</span>
              <span className="grow">{slotSelect(2 * k)}</span>
              <span>vs</span>
              <span className="grow">{slotSelect(2 * k + 1)}</span>
            </div>
          ))}
        </>
      )}
      {isRank && (
        <>
          <div className="row">
            <span className="muted small grow">각 학급이 몇 조에서 뛰는지 고르세요.</span>
            <button className="btn-sm" onClick={() => setHeatCount(heatCount + 1)}>+ 조 추가</button>
          </div>
          <div className="seat-grid">
            {div.entrants.map((c) => (
              <label key={c} className="row" style={{ fontWeight: 400, margin: 0 }}>
                <b style={{ width: 44 }}>{c}</b>
                <select value={heatOf[c] ?? 0} onChange={(e) => setHeatOf({ ...heatOf, [c]: Number(e.target.value) })}>
                  {Array.from({ length: heatCount }, (_, h) => <option key={h} value={h}>{h + 1}조</option>)}
                </select>
              </label>
            ))}
          </div>
        </>
      )}
      {errors.length > 0 && (
        <div className="alert alert-danger">
          <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      <div className="row">
        <button className="btn-primary grow" disabled={errors.length > 0} onClick={save}>자리 저장</button>
        <button onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

// ---------------- 조 동률 → 순위 직접 지정 ----------------

function TieOrder({ rd, g, manual, onSave, onReset }: { rd: ResolvedDivision; g: number; manual: boolean; onSave: (ids: ClassId[]) => void; onReset: () => void }) {
  const st = rd.standings[g];
  const [ids, setIds] = useState<ClassId[] | null>(null);
  if (!st?.complete) return null;
  const tied = st.rows.some((r) => r.tied);
  if (!tied && !manual) return null;
  if (!ids)
    return (
      <div className={`alert ${manual ? 'alert-ok' : 'alert-warn'} row`}>
        <span className="grow">{manual ? '이 조 순위는 직접 지정한 순서입니다.' : '⚖️ 모든 기준이 같은 동률 학급이 있습니다(표의 = 표시). 추첨 등으로 순위를 정하세요.'}</span>
        <button className="btn-sm" onClick={() => setIds(st.rows.map((r) => r.id))}>순위 직접 정하기</button>
        {manual && <button className="btn-sm" onClick={onReset}>자동 계산으로</button>}
      </div>
    );
  const mv = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    const a = [...ids];
    [a[i], a[j]] = [a[j], a[i]];
    setIds(a);
  };
  return (
    <div className="item stack">
      {ids.map((c, i) => (
        <div key={c} className="row">
          <b className="grow">{i + 1}위 · {c}</b>
          <button className="btn-sm btn-icon" onClick={() => mv(i, -1)} aria-label="위로">▲</button>
          <button className="btn-sm btn-icon" onClick={() => mv(i, 1)} aria-label="아래로">▼</button>
        </div>
      ))}
      <div className="row">
        <button className="btn-primary grow" onClick={() => { onSave(ids); setIds(null); }}>이 순서로 확정</button>
        <button onClick={() => setIds(null)}>취소</button>
      </div>
    </div>
  );
}

// ---------------- 순위제 기록 입력 ----------------

function RecordEditor({ ev, div, records, onSave }: { ev: EventConfig; div: Division; records: Record<ClassId, number>; onSave: (r: Record<ClassId, number>) => void }) {
  const rankBy = ev.format.rankBy ?? 'rank';
  const [text, setText] = useState<Record<ClassId, string>>(() => Object.fromEntries(div.entrants.map((c) => [c, records[c] != null ? String(records[c]) : ''])));
  const parsed: Record<ClassId, number> = {};
  for (const [c, v] of Object.entries(text)) if (v.trim() !== '' && !Number.isNaN(Number(v))) parsed[c] = Number(v);
  const bad = Object.entries(text).filter(([, v]) => v.trim() !== '' && Number.isNaN(Number(v))).map(([c]) => c);
  const ranks = Object.fromEntries(rankByRecords(div.entrants, parsed, rankBy).map((r) => [r.id, r.rank]));
  const dirty = JSON.stringify(parsed) !== JSON.stringify(Object.fromEntries(Object.entries(records).filter(([, v]) => v != null)));
  const label = rankBy === 'rank' ? '순위(1, 2, 3…)' : rankBy === 'record_low' ? '기록 (낮을수록 높은 순위 · 예: 52.3초)' : '기록 (높을수록 높은 순위 · 예: 횟수)';
  return (
    <div className="card stack">
      <h3>결과 입력</h3>
      <p className="muted small">{label}. 비워 두면 아직 안 뛴 것으로 봅니다. 순서를 바꾸려면 [자리 수정]에서 조를 바꾸세요.</p>
      {div.heats.map((h, i) => (
        <div key={i}>
          {div.heats.length > 1 && <div className="small"><b>{i + 1}조</b></div>}
          {h.map((c) => (
            <div key={c} className="row" style={{ marginBottom: 6 }}>
              <b style={{ width: 52 }}>{c}</b>
              <input className="grow" inputMode="decimal" value={text[c] ?? ''} onChange={(e) => setText({ ...text, [c]: e.target.value })}
                style={{ maxWidth: 160 }} aria-label={`${c} 기록`} />
              {rankBy !== 'rank' && <span className="muted small">{ranks[c] ? `→ ${ranks[c]}위` : ''}</span>}
            </div>
          ))}
        </div>
      ))}
      {bad.length > 0 && <div className="alert alert-danger">숫자가 아닌 값: {bad.join(', ')}</div>}
      <button className="btn-primary" disabled={!dirty || bad.length > 0} onClick={() => onSave(parsed)}>기록 저장</button>
    </div>
  );
}

// ---------------- 종목 순위(관리자 전용) ----------------

function FinalRankCard({ div, rd, records, ev }: { div: Division; rd: ResolvedDivision; records: Record<ClassId, number>; ev: EventConfig }) {
  const fr = finalRanking(div, rd, records, ev.format.rankBy);
  const decided = fr.filter((r) => r.rank != null).length;
  return (
    <div className="card">
      <h3>🔒 종목 순위 <span className="muted small">(관리자만 보임 · 4단계 점수 계산에 사용)</span></h3>
      <p className="muted small">확정 {decided}/{fr.length}학급. 같은 숫자 = 공동 순위.</p>
      <div className="row">
        {fr.map((r) => (
          <span key={r.id} className={`chip ${r.rank === 1 ? 'chip-gold' : ''}`}>
            {r.rank != null ? `${r.rank}위` : '미정'} · <b>{r.id}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------- 경기 결과 입력 ----------------

function ResultEditor({ ev, m, rd, prev, onSave, onClose }: {
  ev: EventConfig;
  m: ResolvedMatch;
  rd: ResolvedDivision;
  prev?: MatchResult;
  onSave: (r: MatchResult | null, action: string) => void;
  onClose: () => void;
}) {
  const isSets = ev.match.mode === 'sets';
  const need = ev.match.setsToWin ?? 2;
  const maxSets = need * 2 - 1;
  const has = hasResult(prev);
  const [a, setA] = useState(has && prev?.a != null ? String(prev.a) : '');
  const [b, setB] = useState(has && prev?.b != null ? String(prev.b) : '');
  const [sets, setSets] = useState<[string, string][]>(() => {
    const s = (has && prev?.sets) || [];
    return Array.from({ length: maxSets }, (_, i) => (s[i] ? [String(s[i][0]), String(s[i][1])] : ['', '']));
  });
  const [forfeit, setForfeit] = useState<'' | 'a' | 'b'>((has && prev?.forfeit) || '');
  const [tb, setTb] = useState<'' | 'a' | 'b'>((has && prev?.tbWinner) || '');
  const [note, setNote] = useState(prev?.note ?? '');

  const A = whoText(m.sideA);
  const B = whoText(m.sideB);
  const drawAllowed = m.stage === 'group' && !isSets && !!ev.match.allowDraw;

  // 입력값 → 결과
  const filledSets = sets.filter(([x, y]) => x !== '' && y !== '').map(([x, y]) => [Number(x), Number(y)] as [number, number]);
  let na = a === '' ? undefined : Number(a);
  let nb = b === '' ? undefined : Number(b);
  if (isSets && filledSets.length) [na, nb] = setsWon(filledSets);
  const isTie = !forfeit && na != null && nb != null && na === nb && !isSets;
  const r: MatchResult = {
    ...(forfeit ? { forfeit } : { a: na, b: nb }),
    ...(isSets && filledSets.length && !forfeit ? { sets: filledSets } : {}),
    ...(isTie && tb ? { tbWinner: tb } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
    ...(prev?.replays ? { replays: prev.replays } : {}),
    at: Date.now(),
  };
  const err = checkResult(ev.match, r, drawAllowed);

  // 이 경기 결과에 따라 정해지는 다음 경기에 이미 결과가 있으면 경고
  const downstream = rd.matches.filter((x) => [x.a, x.b].some((s) => (s.t === 'win' || s.t === 'lose') && s.m === m.id) && x.result);
  const confirmDownstream = () =>
    !downstream.length || confirm(`다음 경기(${downstream.map((x) => x.label).join(', ')})에 이미 결과가 있습니다.\n승자가 바뀌면 그 경기 결과도 확인하세요. 계속할까요?`);

  const submit = () => {
    if (err) return;
    if (has && !confirmDownstream()) return;
    onSave(r, has ? '경기 결과 수정' : '경기 결과 입력');
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="경기 결과 입력">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>{m.label}</h2>
          <button className="btn-sm" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <p className="muted small">{matchRuleLabel(ev)}{prev?.replays ? ` · 재경기 ${prev.replays}회째` : ''}</p>

        <div className="score-row">
          <div className="score-team">{A}</div>
          <input inputMode="numeric" value={isSets && filledSets.length ? String(na ?? '') : a} disabled={!!forfeit || (isSets && filledSets.length > 0)}
            onChange={(e) => setA(e.target.value.replace(/[^0-9]/g, ''))} aria-label={`${A} 점수`} />
          <span>:</span>
          <input inputMode="numeric" value={isSets && filledSets.length ? String(nb ?? '') : b} disabled={!!forfeit || (isSets && filledSets.length > 0)}
            onChange={(e) => setB(e.target.value.replace(/[^0-9]/g, ''))} aria-label={`${B} 점수`} />
          <div className="score-team">{B}</div>
        </div>
        {isSets && <p className="muted small" style={{ textAlign: 'center' }}>이긴 세트 수를 넣거나, 아래에 세트별 점수를 넣으세요(선택).</p>}

        {isSets && !forfeit && (
          <details open={filledSets.length > 0}>
            <summary className="small">세트별 점수</summary>
            {sets.map(([x, y], i) => (
              <div key={i} className="score-row small-row">
                <div className="score-team small">{i + 1}세트</div>
                <input inputMode="numeric" value={x} onChange={(e) => setSets(sets.map((s, j) => (j === i ? [e.target.value.replace(/[^0-9]/g, ''), s[1]] : s)))} aria-label={`${i + 1}세트 ${A}`} />
                <span>:</span>
                <input inputMode="numeric" value={y} onChange={(e) => setSets(sets.map((s, j) => (j === i ? [s[0], e.target.value.replace(/[^0-9]/g, '')] : s)))} aria-label={`${i + 1}세트 ${B}`} />
                <div className="score-team" />
              </div>
            ))}
          </details>
        )}

        {isTie && (
          <div className="item">
            <div className="small"><b>동점입니다.</b> {drawAllowed ? '무승부로 기록하거나, ' : ''}승부차기·추첨 등으로 이긴 쪽을 고르세요.</div>
            <div className="row" style={{ marginTop: 6 }}>
              {drawAllowed && <button className={`btn-sm ${tb === '' ? 'btn-primary' : ''}`} onClick={() => setTb('')}>무승부</button>}
              <button className={`btn-sm ${tb === 'a' ? 'btn-primary' : ''}`} onClick={() => setTb('a')}>{A} 승</button>
              <button className={`btn-sm ${tb === 'b' ? 'btn-primary' : ''}`} onClick={() => setTb('b')}>{B} 승</button>
            </div>
          </div>
        )}

        <div className="field" style={{ marginTop: 10 }}>
          <label>기권</label>
          <select value={forfeit} onChange={(e) => setForfeit(e.target.value as '' | 'a' | 'b')}>
            <option value="">기권 없음</option>
            <option value="a">{A} 기권 → {B} 승</option>
            <option value="b">{B} 기권 → {A} 승</option>
          </select>
        </div>
        <div className="field">
          <label>메모 (관리자만 보임)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 우천으로 3세트 생략" />
        </div>

        {err && (na != null || nb != null || filledSets.length > 0) && <div className="alert alert-danger">{err}</div>}

        <button className="btn-primary" style={{ width: '100%', fontSize: 18 }} disabled={!!err} onClick={submit}>
          {has ? '결과 수정 저장' : '결과 저장'}
        </button>
        {has && (
          <div className="row" style={{ marginTop: 8 }}>
            <button className="grow" onClick={() => confirmDownstream() && confirm('이 경기를 재경기로 처리할까요? 지금 결과는 이력에 남고, 경기 전 상태로 돌아갑니다.') &&
              onSave({ replays: (prev?.replays ?? 0) + 1, at: Date.now() }, '재경기 처리')}>🔁 재경기</button>
            <button className="grow btn-danger" onClick={() => confirmDownstream() && confirm('잘못 입력한 결과를 지울까요?') &&
              onSave(prev?.replays ? { replays: prev.replays, at: Date.now() } : null, '경기 결과 삭제')}>결과 지우기</button>
          </div>
        )}
      </div>
    </div>
  );
}
