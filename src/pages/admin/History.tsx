// 관리자: 변경 이력(누가 언제 무엇을 바꿨는지) + 경기 결과·기록 되돌리기
import { useState } from 'react';
import { useAdmin } from './AdminLayout';
import { useCollection, useDoc } from '../../data/hooks';
import { isBlind, paths, writeBonus, writeMatchResult, writeRecords, type BlindDoc } from '../../data/store';
import type { MatchResult } from '../../lib/bracket';

interface AuditDoc {
  at: number;
  actor: string;
  actorName: string;
  action: string;
  target: string;
  before: string;
  after: string;
  kind?: string;
  ev?: string;
  matchId?: string;
  div?: string;
  cat?: string;
}

const ADMIN = { name: '관리자' };

function parse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** 경기 결과를 짧은 글로 */
export function resultText(r: unknown): string {
  const x = r as MatchResult | null;
  if (!x || (x.forfeit == null && (x.a == null || x.b == null))) return x?.replays ? `경기 전(재경기 ${x.replays})` : '결과 없음';
  if (x.forfeit) return x.forfeit === 'a' ? '왼쪽 기권' : '오른쪽 기권';
  return `${x.a} : ${x.b}${x.tbWinner && x.a === x.b ? (x.tbWinner === 'a' ? ' (왼쪽 승)' : ' (오른쪽 승)') : ''}${x.sets?.length ? ` [${x.sets.map((s) => s.join('-')).join(', ')}]` : ''}`;
}

function recordsText(r: unknown): string {
  const x = (r ?? {}) as Record<string, number>;
  const e = Object.entries(x);
  return e.length ? e.map(([c, v]) => `${c} ${v}`).join(', ') : '기록 없음';
}

function time(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export default function History() {
  const { tid, config } = useAdmin();
  const [filter, setFilter] = useState<'results' | 'all'>('results');
  const audit = useCollection<AuditDoc>(tid ? paths.audit(tid) : null, 'at', 300);
  const bl = useDoc<BlindDoc>(tid ? paths.blind(tid) : null);
  if (!config || !tid) return <p>먼저 홈에서 대회를 시작하세요.</p>;
  const evName = (id?: string) => config.events.find((e) => e.id === id)?.name ?? id ?? '';
  const list = audit.docs.filter((a) => filter === 'all' || a.kind === 'result' || a.kind === 'records' || a.kind === 'bonus');

  const undo = (a: AuditDoc) => {
    if (a.kind === 'bonus' && a.cat) {
      const cat = config.scoring.bonusCategories.find((c) => c.id === a.cat) ?? { id: a.cat, name: a.target };
      if (!confirm(`이 응원·질서 점수 변경을 되돌릴까요?\n\n${a.target}`)) return;
      writeBonus(tid, cat, (parse(a.after) ?? {}) as Record<string, number>, (parse(a.before) ?? {}) as Record<string, number>, '응원·질서 점수 되돌리기').catch((e) =>
        alert('실패: ' + e.message),
      );
      return;
    }
    if (!a.ev) return;
    const ev = { id: a.ev, name: evName(a.ev) };
    const before = parse(a.before);
    const after = parse(a.after);
    const target = a.target.replace(/^.*? · /, '');
    if (a.kind === 'result' && a.matchId) {
      if (!confirm(`이 변경을 되돌릴까요?\n\n${a.target}\n${resultText(after)} → ${resultText(before)}`)) return;
      writeMatchResult(tid, ev, a.matchId, target, '되돌리기', after, before, ADMIN, isBlind(bl.data, a.ev)).catch((e) => alert('실패: ' + e.message));
    } else if (a.kind === 'records' && a.div) {
      if (!confirm(`이 기록 변경을 되돌릴까요?\n\n${a.target}`)) return;
      writeRecords(tid, ev, a.div, target, (after ?? {}) as Record<string, number>, (before ?? {}) as Record<string, number>, ADMIN, isBlind(bl.data, a.ev)).catch((e) =>
        alert('실패: ' + e.message),
      );
    }
  };

  return (
    <>
      <h1>고친 기록</h1>
      <p className="page-intro">누가 언제 무엇을 넣고 바꿨는지 보여 줘요. 잘못 넣은 결과는 [되돌리기]로 원래대로 돌릴 수 있어요.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className={`btn-sm ${filter === 'results' ? 'btn-primary' : ''}`} onClick={() => setFilter('results')}>경기 결과·점수만</button>
        <button className={`btn-sm ${filter === 'all' ? 'btn-primary' : ''}`} onClick={() => setFilter('all')}>전체</button>
        <span className="muted small grow">최근 300개까지 보여요</span>
      </div>
      {audit.loading ? (
        <p className="muted">불러오는 중…</p>
      ) : audit.error ? (
        <div className="alert alert-danger">이력을 불러오지 못했습니다: {audit.error}</div>
      ) : list.length === 0 ? (
        <div className="card muted">아직 기록이 없습니다.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {list.map((a) => {
            const canUndo = (a.kind === 'result' && a.matchId) || (a.kind === 'records' && a.div) || (a.kind === 'bonus' && a.cat);
            const before = parse(a.before);
            const after = parse(a.after);
            return (
              <div key={a.id} className="hist">
                <div className="hist-time">{time(a.at)}</div>
                <div className="grow">
                  <div>
                    <b>{a.action}</b> · {a.target}
                  </div>
                  {a.kind === 'result' && <div className="small">{resultText(before)} → <b>{resultText(after)}</b></div>}
                  {(a.kind === 'records' || a.kind === 'bonus') && <div className="small">{recordsText(before)} → <b>{recordsText(after)}</b></div>}
                  <div className="muted small">입력: {a.actorName}</div>
                </div>
                {canUndo && <button className="btn-sm" onClick={() => undo(a)}>되돌리기</button>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
