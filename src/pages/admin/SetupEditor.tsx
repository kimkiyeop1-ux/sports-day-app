import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PlanImport from './PlanImport';
import { useAdmin } from './AdminLayout';
import type { EventConfig, FormatType, ScenarioItem, TournamentConfig } from '../../config/types';
import { validateConfig } from '../../config/validate';
import { FORMAT_LABELS } from '../../config/derive';
import { saveConfig } from '../../data/store';
import { parseHM } from '../../lib/time';

type Tab = 'plan' | 'basic' | 'events' | 'scenario' | 'file';

// ---- 목록 편집 도우미 ----
function move<T>(arr: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const a = [...arr];
  [a[i], a[j]] = [a[j], a[i]];
  return a;
}
const rid = (p: string) => p + Math.random().toString(36).slice(2, 7);

export default function SetupEditor() {
  const { config, done } = useAdmin();
  const [draft, setDraft] = useState<TournamentConfig | null>(config);
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'plan' ? 'plan' : 'basic');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 서버 값이 바뀌었고 편집 중인 내용이 없으면 새 값으로 갱신
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(config), [draft, config]);
  useEffect(() => {
    if (!dirty) setDraft(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  if (!draft) return <p>먼저 홈에서 대회를 시작하세요.</p>;
  const errors = validateConfig(draft);
  const set = (patch: Partial<TournamentConfig>) => setDraft({ ...draft, ...patch });

  const save = async () => {
    if (errors.length) return;
    if (config && draft.id !== config.id && !confirm(`대회 ID가 "${draft.id}"(으)로 바뀌어 새 대회로 저장됩니다. 계속할까요?`)) return;
    setSaving(true);
    try {
      await saveConfig(draft, config, draft.id === config?.id ? done : {});
      setMsg('저장했어요. 전광판에도 바로 바뀌어요.');
      setTimeout(() => setMsg(null), 3000);
    } catch (e: any) {
      alert('저장 실패: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h1>설정</h1>
      <p className="page-intro">우리 학교 대회 정보를 넣는 곳이에요. 처음이면 <b>📄 계획서로 만들기</b>부터 하세요. 고친 뒤에는 꼭 아래 <b>[저장하기]</b>를 눌러요.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        {(
          [
            ['plan', '📄 계획서로 만들기'],
            ['basic', '🏫 학교·반'],
            ['events', `🏅 종목·점수 (${draft.events.length})`],
            ['scenario', `⏱ 진행표 (${draft.scenario.length})`],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} className={`btn-sm ${tab === k ? 'btn-primary' : ''}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'plan' && (
        <>
          <PlanImport draft={draft} setDraft={setDraft} onDone={(t) => { setTab(t); window.scrollTo(0, 0); }} />
          <FileTab draft={draft} setDraft={setDraft} />
        </>
      )}
      {tab === 'basic' && <BasicTab draft={draft} set={set} />}
      {tab === 'events' && <EventsTab draft={draft} set={set} />}
      {tab === 'scenario' && <ScenarioTab draft={draft} set={set} />}

      {errors.length > 0 && (
        <div className="alert alert-danger">
          저장하기 전에 고쳐야 할 곳이 있어요:
          <ul>
            {errors.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {msg && <div className="alert alert-ok">{msg}</div>}

      {dirty && (
        <div className="savebar">
          <button className="btn-primary grow" style={{ fontSize: 17 }} disabled={saving || errors.length > 0} onClick={save}>
            {saving ? '저장 중…' : '💾 저장하기'}
          </button>
          <button onClick={() => confirm('저장하지 않은 내용을 버리고 원래대로 돌릴까요?') && setDraft(config)}>취소</button>
        </div>
      )}
    </>
  );
}

type TabProps = { draft: TournamentConfig; set: (p: Partial<TournamentConfig>) => void };

// ================= 기본 정보 · 학년/학급 =================
function BasicTab({ draft, set }: TabProps) {
  return (
    <>
      <div className="card">
        <h2>대회 정보</h2>
        <div className="field">
          <label>대회 이름</label>
          <input value={draft.title} onChange={(e) => set({ title: e.target.value })} />
        </div>
        <div className="grid2">
          <div className="field">
            <label>학교</label>
            <input value={draft.school} onChange={(e) => set({ school: e.target.value })} />
          </div>
          <div className="field">
            <label>날짜</label>
            <input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} />
          </div>
        </div>
        <details>
          <summary className="small muted">내년 대회를 새로 만들 때 (대회 ID)</summary>
          <p className="small muted" style={{ margin: '8px 0' }}>
            대회 ID를 바꾸고 저장하면 <b>새 대회</b>가 만들어지고, 올해 기록은 그대로 남아요. 영어 소문자·숫자·하이픈(-)만 쓸 수 있어요. 예: <code>2027-sportsday</code>
          </p>
          <input value={draft.id} onChange={(e) => set({ id: e.target.value.trim() })} aria-label="대회 ID" />
        </details>
      </div>
      <div className="card">
        <h2>학년별 반 수</h2>
        {draft.grades.map((g, i) => (
          <div key={i} className="row" style={{ marginBottom: 8 }}>
            <input type="number" min={1} style={{ width: 80 }} value={g.grade}
              onChange={(e) => set({ grades: draft.grades.map((x, j) => (j === i ? { ...x, grade: Number(e.target.value) } : x)) })} />
            <span>학년</span>
            <input type="number" min={1} max={30} style={{ width: 80 }} value={g.classCount}
              onChange={(e) => set({ grades: draft.grades.map((x, j) => (j === i ? { ...x, classCount: Number(e.target.value) } : x)) })} />
            <span className="grow">개 반</span>
            <button className="btn-sm btn-danger" onClick={() => set({ grades: draft.grades.filter((_, j) => j !== i) })}>삭제</button>
          </div>
        ))}
        <button className="btn-sm" onClick={() => {
          const next = Math.max(0, ...draft.grades.map((g) => g.grade)) + 1;
          set({ grades: [...draft.grades, { grade: next, classCount: 8 }] });
        }}>+ 학년 추가</button>
      </div>
      <div className="card">
        <h2>응원·질서 점수 항목</h2>
        <p className="muted small">경기 말고 따로 주는 점수예요(응원, 질서, 감점 등). 점수는 대회 날 [점수] 화면에서 넣어요.</p>
        {draft.scoring.bonusCategories.map((b, i) => (
          <div key={b.id} className="row" style={{ marginBottom: 8 }}>
            <input className="grow" value={b.name} onChange={(e) =>
              set({ scoring: { ...draft.scoring, bonusCategories: draft.scoring.bonusCategories.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) } })} />
            <label className="row small" style={{ margin: 0 }}>
              <input type="checkbox" checked={!!b.negative} onChange={(e) =>
                set({ scoring: { ...draft.scoring, bonusCategories: draft.scoring.bonusCategories.map((x, j) => (j === i ? { ...x, negative: e.target.checked } : x)) } })} />
              감점
            </label>
            <button className="btn-sm btn-danger" onClick={() =>
              set({ scoring: { ...draft.scoring, bonusCategories: draft.scoring.bonusCategories.filter((_, j) => j !== i) } })}>삭제</button>
          </div>
        ))}
        <button className="btn-sm" onClick={() =>
          set({ scoring: { ...draft.scoring, bonusCategories: [...draft.scoring.bonusCategories, { id: rid('b'), name: '새 항목' }] } })}>+ 항목 추가</button>
      </div>
    </>
  );
}

// ================= 종목 =================
function NumList({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  useEffect(() => setText(value.join(', ')), [value.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input value={text} inputMode="decimal" onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(text.split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n)))} />
  );
}

function EventsTab({ draft, set }: TabProps) {
  const [open, setOpen] = useState<string | null>(null);
  const upd = (i: number, patch: Partial<EventConfig>) => set({ events: draft.events.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const allGrades = draft.grades.map((g) => g.grade);

  const add = () => {
    const id = rid('event');
    const ev: EventConfig = {
      id, name: '새 종목', scope: 'grade', grades: allGrades, format: { type: 'single_elim' }, match: { mode: 'score' },
      points: { byRank: [100, 80, 60, 50], participation: 10, leagueWin: 3, leagueDraw: 1, leagueLoss: 0, weight: 1 },
    };
    set({ events: [...draft.events, ev] });
    setOpen(id);
  };

  return (
    <>
      {draft.events.map((ev, i) => (
        <div key={i} className="item">
          <div className="item-head">
            <span className="grow" onClick={() => setOpen(open === ev.id ? null : ev.id)} style={{ cursor: 'pointer' }}>
              {i + 1}. {ev.name} <span className="badge">{FORMAT_LABELS[ev.format.type]}</span>
            </span>
            <button className="btn-sm btn-icon" onClick={() => set({ events: move(draft.events, i, -1) })} aria-label="위로">▲</button>
            <button className="btn-sm btn-icon" onClick={() => set({ events: move(draft.events, i, 1) })} aria-label="아래로">▼</button>
            <button className="btn-sm" onClick={() => setOpen(open === ev.id ? null : ev.id)}>{open === ev.id ? '닫기' : '편집'}</button>
          </div>
          {open === ev.id && (
            <div style={{ marginTop: 12 }}>
              <div className="grid2">
                <div className="field"><label>종목 이름</label><input value={ev.name} onChange={(e) => upd(i, { name: e.target.value })} /></div>
                <div className="field"><label>장소</label><input value={ev.location ?? ''} onChange={(e) => upd(i, { location: e.target.value })} /></div>
                <div className="field">
                  <label>누구끼리 경기하나요?</label>
                  <select value={ev.scope} onChange={(e) => upd(i, { scope: e.target.value as 'grade' | 'school' })}>
                    <option value="grade">같은 학년 반끼리</option>
                    <option value="school">전교 모든 반이 함께</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>참가 학년</label>
                <div className="row">
                  {allGrades.map((g) => (
                    <label key={g} className="row" style={{ margin: 0, fontWeight: 400 }}>
                      <input type="checkbox" checked={ev.grades.includes(g)} onChange={(e) =>
                        upd(i, { grades: e.target.checked ? [...ev.grades, g].sort() : ev.grades.filter((x) => x !== g) })} />
                      {g}학년
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid2">
                <div className="field">
                  <label>경기 방식</label>
                  <select value={ev.format.type} onChange={(e) => upd(i, { format: { ...ev.format, type: e.target.value as FormatType } })}>
                    {Object.entries(FORMAT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
                {ev.format.type !== 'ranking' && (
                  <div className="field">
                    <label>이기고 지는 방법</label>
                    <select value={ev.match.mode === 'sets' ? `sets${ev.match.setsToWin ?? 2}` : 'score'}
                      onChange={(e) => {
                        const v = e.target.value;
                        upd(i, { match: v === 'score' ? { mode: 'score', allowDraw: ev.match.allowDraw } : { mode: 'sets', setsToWin: Number(v.slice(4)) } });
                      }}>
                      <option value="score">점수가 높으면 이김</option>
                      <option value="sets1">단판</option>
                      <option value="sets2">3판 2선승</option>
                      <option value="sets3">5판 3선승</option>
                    </select>
                  </div>
                )}
              </div>
              {(ev.format.type === 'single_elim' || ev.format.type === 'groups_knockout') && (
                <label className="row" style={{ fontWeight: 400 }}>
                  <input type="checkbox" checked={!!ev.format.thirdPlaceMatch} onChange={(e) => upd(i, { format: { ...ev.format, thirdPlaceMatch: e.target.checked } })} />
                  3·4위 결정전도 해요
                </label>
              )}
              {ev.format.type === 'groups_knockout' && (
                <div className="grid2">
                  <div className="field"><label>몇 개 조로 나눌까요?</label><input type="number" min={2} value={ev.format.groupCount ?? 2} onChange={(e) => upd(i, { format: { ...ev.format, groupCount: Number(e.target.value) } })} /></div>
                  <div className="field"><label>조마다 몇 반이 토너먼트에 올라가요?</label><input type="number" min={1} value={ev.format.advancePerGroup ?? 2} onChange={(e) => upd(i, { format: { ...ev.format, advancePerGroup: Number(e.target.value) } })} /></div>
                </div>
              )}
              {(ev.format.type === 'round_robin' || ev.format.type === 'groups_knockout') && ev.match.mode === 'score' && (
                <label className="row" style={{ fontWeight: 400 }}>
                  <input type="checkbox" checked={!!ev.match.allowDraw} onChange={(e) => upd(i, { match: { ...ev.match, allowDraw: e.target.checked } })} />
                  리그에서 비기는 것도 인정해요
                </label>
              )}
              {ev.format.type === 'ranking' && (
                <div className="grid2">
                  <div className="field"><label>한 번에 같이 뛰는 반 수 (0 = 모두 한 번에)</label><input type="number" min={0} value={ev.format.heatSize ?? 0} onChange={(e) => upd(i, { format: { ...ev.format, heatSize: Number(e.target.value) } })} /></div>
                  <div className="field">
                    <label>순위는 어떻게 정해요?</label>
                    <select value={ev.format.rankBy ?? 'rank'} onChange={(e) => upd(i, { format: { ...ev.format, rankBy: e.target.value as 'rank' | 'record_low' | 'record_high' } })}>
                      <option value="rank">순위를 직접 입력</option>
                      <option value="record_low">기록이 낮을수록 위(달리기 시간 등)</option>
                      <option value="record_high">기록이 높을수록 위(횟수 등)</option>
                    </select>
                  </div>
                </div>
              )}
              <h3 style={{ marginTop: 12 }}>점수 🔒 <span className="muted small">(선생님만 보여요)</span></h3>
              <div className="field"><label>순위마다 받는 점수 (1위, 2위, 3위… 쉼표로 나눠 쓰기)</label><NumList value={ev.points.byRank} onChange={(v) => upd(i, { points: { ...ev.points, byRank: v } })} /></div>
              <div className="grid2">
                <div className="field"><label>참가만 해도 받는 점수</label><input type="number" value={ev.points.participation} onChange={(e) => upd(i, { points: { ...ev.points, participation: Number(e.target.value) } })} /></div>
                <div className="field"><label>점수 배수 (보통 1, 중요한 종목은 1.5·2)</label><input type="number" step="0.1" value={ev.points.weight} onChange={(e) => upd(i, { points: { ...ev.points, weight: Number(e.target.value) } })} /></div>
              </div>
              {(ev.format.type === 'round_robin' || ev.format.type === 'groups_knockout') && (
                <div className="field"><label>리그 순위를 정하는 승점 (이김, 비김, 짐)</label>
                  <NumList value={[ev.points.leagueWin, ev.points.leagueDraw, ev.points.leagueLoss]}
                    onChange={(v) => upd(i, { points: { ...ev.points, leagueWin: v[0] ?? 3, leagueDraw: v[1] ?? 1, leagueLoss: v[2] ?? 0 } })} />
                </div>
              )}
              <div className="field"><label>메모 (선생님만 보여요)</label><input value={ev.memo ?? ''} onChange={(e) => upd(i, { memo: e.target.value })} /></div>
              <button className="btn-sm btn-danger" onClick={() => confirm(`"${ev.name}" 종목을 삭제할까요?`) && set({ events: draft.events.filter((_, j) => j !== i) })}>이 종목 삭제</button>
            </div>
          )}
        </div>
      ))}
      <button onClick={add}>+ 종목 추가</button>
    </>
  );
}

// ================= 시나리오 =================
function ScenarioTab({ draft, set }: TabProps) {
  const upd = (i: number, patch: Partial<ScenarioItem>) => set({ scenario: draft.scenario.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const sortByTime = () =>
    set({ scenario: [...draft.scenario].map((s, i) => ({ s, i })).sort((a, b) => (parseHM(a.s.time) ?? 0) - (parseHM(b.s.time) ?? 0) || a.i - b.i).map((x) => x.s) });
  const add = () => {
    const last = draft.scenario[draft.scenario.length - 1];
    const t = last ? (parseHM(last.time) ?? 540) + (last.durationMin || 10) : 540;
    const time = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    set({ scenario: [...draft.scenario, { id: rid('s'), time, durationMin: 10, title: '새 순서' }] });
  };
  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="muted small grow">위에서부터 순서대로 진행해요. 방송 멘트는 선생님 화면에만 보여요.</span>
        <button className="btn-sm" onClick={sortByTime}>시각순 정렬</button>
      </div>
      {draft.scenario.map((s, i) => (
        <div key={s.id} className="item">
          <div className="row">
            <input type="time" style={{ width: 120 }} value={s.time} onChange={(e) => upd(i, { time: e.target.value })} />
            <input className="grow" value={s.title} onChange={(e) => upd(i, { title: e.target.value })} placeholder="순서 이름" />
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <input type="number" min={0} style={{ width: 80 }} value={s.durationMin} onChange={(e) => upd(i, { durationMin: Number(e.target.value) })} />
            <span className="small">분</span>
            <input className="grow" style={{ width: 120 }} value={s.owner ?? ''} onChange={(e) => upd(i, { owner: e.target.value })} placeholder="담당자" />
            <select style={{ width: 130 }} value={s.eventId ?? ''} onChange={(e) => upd(i, { eventId: e.target.value || undefined })}>
              <option value="">(종목 없음)</option>
              {draft.events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
            </select>
          </div>
          <textarea style={{ marginTop: 6 }} value={s.note ?? ''} onChange={(e) => upd(i, { note: e.target.value })} placeholder="방송 멘트 (선생님만 보여요)" />
          <div className="row" style={{ marginTop: 6, justifyContent: 'flex-end' }}>
            <button className="btn-sm btn-icon" onClick={() => set({ scenario: move(draft.scenario, i, -1) })} aria-label="위로">▲</button>
            <button className="btn-sm btn-icon" onClick={() => set({ scenario: move(draft.scenario, i, 1) })} aria-label="아래로">▼</button>
            <button className="btn-sm btn-danger" onClick={() => set({ scenario: draft.scenario.filter((_, j) => j !== i) })}>삭제</button>
          </div>
        </div>
      ))}
      <button onClick={add}>+ 순서 추가</button>
    </>
  );
}

// ================= 파일 가져오기/내보내기 =================
function FileTab({ draft, setDraft }: { draft: TournamentConfig; setDraft: (c: TournamentConfig) => void }) {
  const download = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${draft.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const load = async (f?: File) => {
    if (!f) return;
    try {
      const c = JSON.parse(await f.text());
      const errs = validateConfig(c);
      if (errs.length && !confirm(`파일에 고칠 곳이 ${errs.length}개 있어요. 그래도 불러와서 고칠까요?\n\n${errs.slice(0, 5).join('\n')}`)) return;
      setDraft(c);
      alert('불러왔어요. 확인한 뒤 아래 [저장하기]를 누르세요.');
    } catch {
      alert('이 파일은 읽을 수 없어요. 앱에서 저장한 .json 파일인지 확인하세요.');
    }
  };
  return (
    <details className="card">
      <summary className="small" style={{ cursor: 'pointer' }}>📁 대회 설정을 파일로 저장하거나 불러오기 (내년에 다시 쓸 때)</summary>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn-sm" onClick={download}>⬇ 파일로 저장</button>
        <label className="btn btn-sm" style={{ marginBottom: 0 }}>
          ⬆ 파일 불러오기
          <input type="file" accept=".json,application/json" hidden onChange={(e) => load(e.target.files?.[0])} />
        </label>
      </div>
    </details>
  );
}
