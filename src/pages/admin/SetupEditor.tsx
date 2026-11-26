import { useEffect, useMemo, useState } from 'react';
import { useAdmin } from './AdminLayout';
import type { EventConfig, FormatType, ScenarioItem, TournamentConfig } from '../../config/types';
import { loadSample } from '../../config/sample';
import { validateConfig } from '../../config/validate';
import { FORMAT_LABELS } from '../../config/derive';
import { saveConfig } from '../../data/store';
import { parseHM } from '../../lib/time';

type Tab = 'basic' | 'events' | 'scenario' | 'file';

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
  const [tab, setTab] = useState<Tab>('basic');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 서버 값이 바뀌었고 편집 중인 내용이 없으면 새 값으로 갱신
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(config), [draft, config]);
  useEffect(() => {
    if (!dirty) setDraft(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  if (!draft) return <p>먼저 대시보드에서 대회를 시작하세요.</p>;
  const errors = validateConfig(draft);
  const set = (patch: Partial<TournamentConfig>) => setDraft({ ...draft, ...patch });

  const save = async () => {
    if (errors.length) return;
    if (config && draft.id !== config.id && !confirm(`대회 ID가 "${draft.id}"(으)로 바뀌어 새 대회로 저장됩니다. 계속할까요?`)) return;
    setSaving(true);
    try {
      await saveConfig(draft, config, draft.id === config?.id ? done : {});
      setMsg('저장했습니다. 전광판에도 바로 반영됩니다.');
      setTimeout(() => setMsg(null), 3000);
    } catch (e: any) {
      alert('저장 실패: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h1>대회 설정</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        {(
          [
            ['basic', '기본·학급'],
            ['events', `종목(${draft.events.length})`],
            ['scenario', `시나리오(${draft.scenario.length})`],
            ['file', '파일'],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} className={`btn-sm ${tab === k ? 'btn-primary' : ''}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'basic' && <BasicTab draft={draft} set={set} />}
      {tab === 'events' && <EventsTab draft={draft} set={set} />}
      {tab === 'scenario' && <ScenarioTab draft={draft} set={set} />}
      {tab === 'file' && <FileTab draft={draft} setDraft={setDraft} />}

      {errors.length > 0 && (
        <div className="alert alert-danger">
          저장하기 전에 고쳐야 할 부분:
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
            {saving ? '저장 중…' : '변경 내용 저장'}
          </button>
          <button onClick={() => confirm('저장하지 않은 변경을 버릴까요?') && setDraft(config)}>되돌리기</button>
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
        <h2>기본 정보</h2>
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
        <div className="field">
          <label>대회 ID (영문·숫자·하이픈, 바꾸면 새 대회가 됩니다)</label>
          <input value={draft.id} onChange={(e) => set({ id: e.target.value.trim() })} />
        </div>
      </div>
      <div className="card">
        <h2>학년·학급</h2>
        {draft.grades.map((g, i) => (
          <div key={i} className="row" style={{ marginBottom: 8 }}>
            <input type="number" min={1} style={{ width: 80 }} value={g.grade}
              onChange={(e) => set({ grades: draft.grades.map((x, j) => (j === i ? { ...x, grade: Number(e.target.value) } : x)) })} />
            <span>학년</span>
            <input type="number" min={1} max={30} style={{ width: 80 }} value={g.classCount}
              onChange={(e) => set({ grades: draft.grades.map((x, j) => (j === i ? { ...x, classCount: Number(e.target.value) } : x)) })} />
            <span className="grow">학급</span>
            <button className="btn-sm btn-danger" onClick={() => set({ grades: draft.grades.filter((_, j) => j !== i) })}>삭제</button>
          </div>
        ))}
        <button className="btn-sm" onClick={() => {
          const next = Math.max(0, ...draft.grades.map((g) => g.grade)) + 1;
          set({ grades: [...draft.grades, { grade: next, classCount: 8 }] });
        }}>+ 학년 추가</button>
      </div>
      <div className="card">
        <h2>경기 외 점수 항목</h2>
        <p className="muted small">응원점수·질서점수·감점 등 (점수 입력은 [점수·순위 → 경기 외 점수]에서)</p>
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
                <div className="field"><label>종목명</label><input value={ev.name} onChange={(e) => upd(i, { name: e.target.value })} /></div>
                <div className="field"><label>종목 ID (영문)</label><input value={ev.id} onChange={(e) => { upd(i, { id: e.target.value.trim() }); setOpen(e.target.value.trim()); }} /></div>
                <div className="field"><label>장소</label><input value={ev.location ?? ''} onChange={(e) => upd(i, { location: e.target.value })} /></div>
                <div className="field">
                  <label>대진 단위</label>
                  <select value={ev.scope} onChange={(e) => upd(i, { scope: e.target.value as 'grade' | 'school' })}>
                    <option value="grade">학년별로 따로</option>
                    <option value="school">전교 함께</option>
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
                    <label>승패 결정</label>
                    <select value={ev.match.mode === 'sets' ? `sets${ev.match.setsToWin ?? 2}` : 'score'}
                      onChange={(e) => {
                        const v = e.target.value;
                        upd(i, { match: v === 'score' ? { mode: 'score', allowDraw: ev.match.allowDraw } : { mode: 'sets', setsToWin: Number(v.slice(4)) } });
                      }}>
                      <option value="score">점수제(득점 비교)</option>
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
                  3·4위전 진행
                </label>
              )}
              {ev.format.type === 'groups_knockout' && (
                <div className="grid2">
                  <div className="field"><label>조 개수</label><input type="number" min={2} value={ev.format.groupCount ?? 2} onChange={(e) => upd(i, { format: { ...ev.format, groupCount: Number(e.target.value) } })} /></div>
                  <div className="field"><label>조별 진출 수</label><input type="number" min={1} value={ev.format.advancePerGroup ?? 2} onChange={(e) => upd(i, { format: { ...ev.format, advancePerGroup: Number(e.target.value) } })} /></div>
                </div>
              )}
              {(ev.format.type === 'round_robin' || ev.format.type === 'groups_knockout') && ev.match.mode === 'score' && (
                <label className="row" style={{ fontWeight: 400 }}>
                  <input type="checkbox" checked={!!ev.match.allowDraw} onChange={(e) => upd(i, { match: { ...ev.match, allowDraw: e.target.checked } })} />
                  리그전 무승부 허용
                </label>
              )}
              {ev.format.type === 'ranking' && (
                <div className="grid2">
                  <div className="field"><label>한 번에 뛰는 학급 수 (0 = 전체 한 번에)</label><input type="number" min={0} value={ev.format.heatSize ?? 0} onChange={(e) => upd(i, { format: { ...ev.format, heatSize: Number(e.target.value) } })} /></div>
                  <div className="field">
                    <label>순위 정하는 방법</label>
                    <select value={ev.format.rankBy ?? 'rank'} onChange={(e) => upd(i, { format: { ...ev.format, rankBy: e.target.value as 'rank' | 'record_low' | 'record_high' } })}>
                      <option value="rank">순위를 직접 입력</option>
                      <option value="record_low">기록이 낮을수록 위(달리기 시간 등)</option>
                      <option value="record_high">기록이 높을수록 위(횟수 등)</option>
                    </select>
                  </div>
                </div>
              )}
              <h3 style={{ marginTop: 12 }}>배점 🔒 <span className="muted small">(관리자만 볼 수 있음)</span></h3>
              <div className="field"><label>순위별 점수 (1위, 2위, 3위… 쉼표로 구분)</label><NumList value={ev.points.byRank} onChange={(v) => upd(i, { points: { ...ev.points, byRank: v } })} /></div>
              <div className="grid2">
                <div className="field"><label>참가점</label><input type="number" value={ev.points.participation} onChange={(e) => upd(i, { points: { ...ev.points, participation: Number(e.target.value) } })} /></div>
                <div className="field"><label>가중치 (×)</label><input type="number" step="0.1" value={ev.points.weight} onChange={(e) => upd(i, { points: { ...ev.points, weight: Number(e.target.value) } })} /></div>
              </div>
              {(ev.format.type === 'round_robin' || ev.format.type === 'groups_knockout') && (
                <div className="field"><label>리그 승점 (승, 무, 패)</label>
                  <NumList value={[ev.points.leagueWin, ev.points.leagueDraw, ev.points.leagueLoss]}
                    onChange={(v) => upd(i, { points: { ...ev.points, leagueWin: v[0] ?? 3, leagueDraw: v[1] ?? 1, leagueLoss: v[2] ?? 0 } })} />
                </div>
              )}
              <div className="field"><label>메모</label><input value={ev.memo ?? ''} onChange={(e) => upd(i, { memo: e.target.value })} /></div>
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
        <span className="muted small grow">목록 순서 = 진행 순서입니다.</span>
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
          <textarea style={{ marginTop: 6 }} value={s.note ?? ''} onChange={(e) => upd(i, { note: e.target.value })} placeholder="방송 멘트 메모 (관리자만 보임)" />
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
      if (errs.length && !confirm(`파일에 문제가 ${errs.length}개 있습니다. 그래도 불러와서 고칠까요?\n\n${errs.slice(0, 5).join('\n')}`)) return;
      setDraft(c);
      alert('불러왔습니다. 확인 후 아래 [변경 내용 저장]을 누르세요.');
    } catch {
      alert('JSON 파일을 읽을 수 없습니다.');
    }
  };
  return (
    <div className="card stack">
      <h2>설정 파일</h2>
      <p className="muted small">현재 설정을 JSON 파일로 내려받아 백업하거나, 다른 파일(새 학교·새 해)로 교체할 수 있습니다.</p>
      <button onClick={download}>⬇ 현재 설정 내려받기 (.json)</button>
      <label className="btn" style={{ marginBottom: 0 }}>
        ⬆ JSON 파일 불러오기
        <input type="file" accept=".json,application/json" hidden onChange={(e) => load(e.target.files?.[0])} />
      </label>
      <button onClick={() => confirm('샘플 설정으로 바꿀까요? (저장 전까지는 반영되지 않습니다)') && loadSample().then(setDraft)}>
        샘플 설정 불러오기
      </button>
    </div>
  );
}
