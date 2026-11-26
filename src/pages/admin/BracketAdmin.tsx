// 관리자: 대진표 생성·자리 수정(추첨 결과 입력)·경기 결과 입력
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAdmin } from './AdminLayout';
import { SyncBadge } from './AdminLayout';
import type { ClassId, EventConfig, TournamentConfig } from '../../config/types';
import { FORMAT_LABELS, matchRuleLabel } from '../../config/derive';
import { useDoc, useJsonDoc } from '../../data/hooks';
import {
  emptyBracket,
  isBlind,
  leaguePointsOf,
  paths,
  readResults,
  saveBracket,
  writeMatchResult,
  writeNote,
  writeRecords,
  type BlindDoc,
  type BracketData,
  type Records,
  type ResultsDoc,
} from '../../data/store';
import {
  buildMatches,
  createDivision,
  divisionsOf,
  finalRanking,
  groupName,
  hasResult,
  resolveDivision,
  shuffle,
  slotText,
  type Division,
  type ResolvedDivision,
  type ResolvedMatch,
  type Results,
  type Slot,
} from '../../lib/bracket';
import { GroupsView, HeatsView, KnockoutView, whoText } from '../bracket/BracketView';
import { RecordEditor, ResultEditor } from '../bracket/Editors';

const ADMIN = { name: '관리자' };

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

/** 대진표 구조를 바꾸는 저장. reset이 있으면 결과 문서도 통째로 바꾼다 */
type SaveFn = (
  update: (d: BracketData) => BracketData,
  action: string,
  target: string,
  before: unknown,
  after: unknown,
  reset?: (cur: { results: Results; records: Records }) => { results: Results; records: Records },
) => Promise<void>;

function EventBracket({ tid, cfg, ev }: { tid: string; cfg: TournamentConfig; ev: EventConfig }) {
  const s = useJsonDoc<BracketData>(paths.bracket(tid, ev.id));
  const rs = useDoc<ResultsDoc>(paths.results(tid, ev.id));
  const ns = useDoc<{ n?: Record<string, string> }>(paths.notes(tid, ev.id));
  const bl = useDoc<BlindDoc>(paths.blind(tid));
  const blind = isBlind(bl.data, ev.id);
  const hs = useDoc<ResultsDoc>(blind ? paths.hidden(tid, ev.id) : null);
  const data = s.data ?? emptyBracket(ev.id);
  const wanted = divisionsOf(ev, cfg);
  const legacy = s.data && (Object.keys(s.data.results ?? {}).length || Object.keys(s.data.records ?? {}).length) ? s.data : null;
  const { results, records } = useMemo(() => readResults(rs.data, legacy, blind ? hs.data : null), [rs.data, legacy, blind, hs.data]);

  // 빠르게 연달아 저장해도 앞의 변경이 덮어써지지 않도록 '가장 최근 값'에 변경을 적용한다
  const latest = useRef<{ from: BracketData | null; value: BracketData }>({ from: null, value: data });
  if (latest.current.from !== s.data) latest.current = { from: s.data, value: data };
  const save: SaveFn = (update, action, target, before, after, reset) => {
    if (blind && (reset || legacy)) {
      alert('블라인드 중에는 대진표를 다시 만들거나 자리를 바꿀 수 없습니다. [블라인드·최종 공개]에서 결과를 공개한 뒤 하세요.');
      return Promise.resolve();
    }
    const next = update(latest.current.value);
    latest.current.value = next;
    // 2단계 형식(대진표 문서 안의 결과)이 남아 있으면 이번 저장 때 결과 문서로 옮긴다
    const cur = { results, records };
    const rr = reset ? reset(cur) : legacy ? cur : undefined;
    return saveBracket(tid, ev, next, { action, target, before, after }, rr).catch((e) => alert('저장 실패: ' + e.message));
  };

  // 2단계 형식 결과를 한 번 옮겨 둔다(심판이 결과를 볼 수 있도록)
  const migrated = useRef(false);
  useEffect(() => {
    if (legacy && !rs.loading && !bl.loading && !blind && !migrated.current) {
      migrated.current = true;
      save((d) => d, '결과 저장 형식 옮기기(3단계)', '전체', null, null);
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (s.loading || rs.loading || bl.loading || hs.loading) return <p className="muted">불러오는 중…</p>;

  return (
    <>
      <div className="row muted small" style={{ marginBottom: 8 }}>
        <span className="badge">{FORMAT_LABELS[ev.format.type]}</span>
        <span className="badge">{matchRuleLabel(ev)}</span>
        {ev.location && <span>{ev.location}</span>}
        <span className="grow" />
        <SyncBadge pending={s.pending || rs.pending || hs.pending} />
      </div>
      {blind && (
        <div className="alert alert-warn">
          🙈 <b>블라인드 중</b>입니다. 지금부터 입력하는 결과는 공개 대진표에 나오지 않고, [블라인드·최종 공개]에서 [결과 공개]를 누를 때 한꺼번에 공개됩니다.
        </div>
      )}
      {wanted.map((w) => {
        const div = data.divisions.find((d) => d.key === w.key);
        const generate = (draw: boolean) => {
          const nd = createDivision(ev, w.key, w.title, draw ? shuffle(w.entrants) : w.entrants);
          const next = (d0: BracketData): BracketData => ({
            ...d0,
            divisions: [...d0.divisions.filter((d) => d.key !== w.key), nd].sort((a, b) => a.key.localeCompare(b.key)),
            groupOrder: { ...d0.groupOrder, [w.key]: {} },
          });
          save(next, div ? '대진표 다시 만들기' : '대진표 만들기', w.title, div ? div.entrants : null, { draw, entrants: nd.entrants },
            (cur) => ({ results: withoutDiv(cur.results, w.key), records: { ...cur.records, [w.key]: {} } }));
        };
        if (!div) return <CreateCard key={w.key} title={w.title} count={w.entrants.length} multi={wanted.length > 1} onCreate={generate} />;
        return (
          <DivisionPanel key={w.key} tid={tid} ev={ev} div={div} data={data} results={results} records={records[w.key] ?? {}}
            notes={ns.data?.n ?? {}} entrants={w.entrants} multi={wanted.length > 1} save={save} regenerate={generate} blind={blind} />
        );
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

function DivisionPanel({ tid, ev, div, data, results, records, notes, entrants, multi, save, regenerate, blind }: {
  tid: string;
  ev: EventConfig;
  div: Division;
  data: BracketData;
  results: Results;
  records: Record<ClassId, number>;
  notes: Record<string, string>;
  entrants: ClassId[];
  multi: boolean;
  save: SaveFn;
  regenerate: (draw: boolean) => void;
  blind: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState<ResolvedMatch | null>(null);
  const lp = leaguePointsOf(ev);
  const order = data.groupOrder[div.key] ?? {};
  const rd = useMemo(() => resolveDivision(div, results, lp, order), [div, results, order]); // eslint-disable-line react-hooks/exhaustive-deps
  const resultCount = Object.keys(results).filter((k) => k.startsWith(div.key + '-') && hasResult(results[k])).length
    + Object.keys(records).length;
  const fail = (e: Error) => alert('저장 실패: ' + e.message);

  // 대회 설정이 바뀌어 대진표와 맞지 않는지 확인
  const stale =
    div.format !== ev.format.type ||
    [...div.entrants].sort().join() !== [...entrants].sort().join() ||
    (div.format !== 'ranking' && div.thirdPlace !== !!ev.format.thirdPlaceMatch);

  const updateDiv = (nd: Division, action: string, before: unknown, after: unknown) =>
    save(
      (d0) => ({ ...d0, divisions: d0.divisions.map((d) => (d.key === div.key ? nd : d)), groupOrder: { ...d0.groupOrder, [div.key]: {} } }),
      action, div.title, before, after,
      (cur) => ({ results: withoutDiv(cur.results, div.key), records: div.format === 'ranking' ? cur.records : { ...cur.records, [div.key]: {} } }),
    );

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
        <RecordEditor div={div} records={records} rankBy={ev.format.rankBy}
          onSave={(rec) => writeRecords(tid, ev, div.key, div.title, records, rec, ADMIN, blind).catch(fail)} />
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
        <ResultEditor rule={ev.match} ruleLabel={matchRuleLabel(ev)} m={rd.byId[open.id] ?? open} rd={rd} prev={results[open.id]}
          note={notes[open.id]} showNote onClose={() => setOpen(null)}
          onSave={(r, action, note) => {
            const m = rd.byId[open.id];
            const target = `${div.title} ${m.label} (${whoText(m.sideA)} vs ${whoText(m.sideB)})`;
            writeMatchResult(tid, ev, open.id, target, action, results[open.id] ?? null, r, ADMIN, blind).catch(fail);
            if (note !== undefined && note !== (notes[open.id] ?? '')) writeNote(tid, ev.id, open.id, note).catch(fail);
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

// ---------------- 종목 순위(관리자 전용) ----------------

function FinalRankCard({ div, rd, records, ev }: { div: Division; rd: ResolvedDivision; records: Record<ClassId, number>; ev: EventConfig }) {
  const fr = finalRanking(div, rd, records, ev.format.rankBy);
  const decided = fr.filter((r) => r.rank != null).length;
  return (
    <div className="card">
      <h3>🔒 종목 순위 <span className="muted small">(관리자만 보임 · 점수·순위 계산에 사용)</span></h3>
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
