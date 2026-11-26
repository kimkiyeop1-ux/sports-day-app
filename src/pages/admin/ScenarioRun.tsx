import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdmin } from './AdminLayout';
import { useNow } from '../../data/hooks';
import { computeProgress, itemDelay } from '../../lib/scenario';
import { clockHM, delayLabel, parseHM } from '../../lib/time';
import { setScenarioDone } from '../../data/store';

export default function ScenarioRun() {
  const { config, done, loading } = useAdmin();
  const now = useNow(10000);
  const [showAllNotes, setShowAllNotes] = useState(false);

  if (loading) return <p className="muted">불러오는 중…</p>;
  if (!config) return <p>먼저 <Link to="/admin">홈</Link>에서 대회를 시작하세요.</p>;

  const p = computeProgress(config.scenario, done, now);

  const toggle = (id: string) => {
    if (done[id] != null) {
      if (!confirm('완료 표시를 취소할까요?')) return;
      setScenarioDone(config, done, id, null);
    } else {
      setScenarioDone(config, done, id, Date.now());
    }
  };

  const editTime = (id: string) => {
    const cur = done[id] != null ? clockHM(done[id]) : '';
    const v = prompt('실제 완료 시각을 HH:MM 형식으로 입력하세요', cur);
    if (v == null) return;
    const m = parseHM(v);
    if (m == null) return alert('HH:MM 형식(예: 09:45)으로 입력하세요.');
    const d = new Date();
    d.setHours(Math.floor(m / 60), m % 60, 0, 0);
    setScenarioDone(config, done, id, d.getTime());
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>
          진행표
        </h1>
        <span className={`badge ${p.delayMin > 5 ? 'badge-danger' : p.delayMin > 0 ? 'badge-warn' : 'badge-ok'}`} style={{ fontSize: 15 }}>
          {delayLabel(p.delayMin)}
        </span>
      </div>

      <p className="page-intro">대회 순서표예요. 한 순서가 끝나면 <b>[완료]</b>를 누르세요. 전광판이 다음 순서로 바뀌어요. 📢는 방송할 말이에요.</p>

      {p.current && (
        <div className="card" style={{ borderColor: 'var(--primary)', borderWidth: 2 }}>
          <div className="muted small">지금 진행 중 · 계획 {p.current.time}</div>
          <h2 style={{ margin: '4px 0 8px' }}>{p.current.title}</h2>
          {p.current.owner && <div className="muted small">담당: {p.current.owner}</div>}
          {p.current.note && <div className="sc-note">📢 {p.current.note}</div>}
          <button className="btn-ok" style={{ width: '100%', marginTop: 12, fontSize: 18 }} onClick={() => toggle(p.current!.id)}>
            ✓ 완료 ({clockHM(now)})
          </button>
          {p.next && (
            <div className="muted small" style={{ marginTop: 8 }}>
              다음: {p.next.time} {p.next.title}
            </div>
          )}
        </div>
      )}

      <div className="row" style={{ margin: '8px 0' }}>
        <h2 className="grow" style={{ margin: 0 }}>
          전체 순서 ({p.doneCount}/{p.total} 끝남)
        </h2>
        <label className="row small" style={{ margin: 0, fontWeight: 400 }}>
          <input type="checkbox" checked={showAllNotes} onChange={(e) => setShowAllNotes(e.target.checked)} /> 멘트 모두 보기
        </label>
      </div>
      <div className="card" style={{ padding: 4 }}>
        {config.scenario.map((s) => {
          const at = done[s.id];
          const isCur = p.current?.id === s.id;
          return (
            <div key={s.id} className={`sc-item ${at != null ? 'sc-done' : ''} ${isCur ? 'sc-current' : ''}`}>
              <input type="checkbox" checked={at != null} onChange={() => toggle(s.id)} aria-label={`${s.title} 완료`} />
              <div className="sc-time">{s.time}</div>
              <div className="grow">
                <div style={{ fontWeight: 700 }}>{s.title}</div>
                <div className="muted small">
                  {s.durationMin}분{s.owner ? ` · ${s.owner}` : ''}
                </div>
                {at != null && (
                  <div className="small">
                    <button className="btn-sm" style={{ minHeight: 28, padding: '2px 8px' }} onClick={() => editTime(s.id)}>
                      완료 {clockHM(at)}
                    </button>{' '}
                    <span className={`badge ${itemDelay(s, at) > 0.5 ? 'badge-warn' : 'badge-ok'}`}>{delayLabel(itemDelay(s, at))}</span>
                  </div>
                )}
                {s.note && (showAllNotes || isCur) && at == null && <div className="sc-note">📢 {s.note}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
