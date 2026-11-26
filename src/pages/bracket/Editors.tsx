// 경기 결과 입력 · 순위제 기록 입력 (관리자·심판 화면 공용)
// 배점 관련 코드를 가져오지 않는다(심판 기기에 배점이 전달되지 않도록).
import { useState } from 'react';
import type { ClassId, MatchRule } from '../../config/types';
import {
  checkResult,
  hasResult,
  rankByRecords,
  setsWon,
  type Division,
  type MatchResult,
  type ResolvedDivision,
  type ResolvedMatch,
} from '../../lib/bracket';
import { whoText } from './BracketView';

export type RankBy = 'rank' | 'record_low' | 'record_high';

// ---------------- 순위제 기록 입력 ----------------
export function RecordEditor({ div, records, rankBy = 'rank', onSave }: {
  div: Division;
  records: Record<ClassId, number>;
  rankBy?: RankBy;
  onSave: (r: Record<ClassId, number>) => void;
}) {
  const [text, setText] = useState<Record<ClassId, string>>(() => Object.fromEntries(div.entrants.map((c) => [c, records[c] != null ? String(records[c]) : ''])));
  // 다른 기기(심판·관리자)에서 기록이 바뀌면 편집 중이 아닐 때 화면에 반영
  const server = JSON.stringify(records);
  const [seen, setSeen] = useState(server);
  if (seen !== server) {
    setSeen(server);
    setText(Object.fromEntries(div.entrants.map((c) => [c, records[c] != null ? String(records[c]) : ''])));
  }
  const parsed: Record<ClassId, number> = {};
  for (const [c, v] of Object.entries(text)) if (v.trim() !== '' && !Number.isNaN(Number(v))) parsed[c] = Number(v);
  const bad = Object.entries(text).filter(([, v]) => v.trim() !== '' && Number.isNaN(Number(v))).map(([c]) => c);
  const ranks = Object.fromEntries(rankByRecords(div.entrants, parsed, rankBy).map((r) => [r.id, r.rank]));
  const dirty = JSON.stringify(parsed) !== JSON.stringify(Object.fromEntries(Object.entries(records).filter(([, v]) => v != null)));
  const label = rankBy === 'rank' ? '순위(1, 2, 3…)' : rankBy === 'record_low' ? '기록 (낮을수록 높은 순위 · 예: 52.3초)' : '기록 (높을수록 높은 순위 · 예: 횟수)';
  return (
    <div className="card stack">
      <h3>결과 입력</h3>
      <p className="muted small">{label}. 비워 두면 아직 안 뛴 것으로 봅니다. </p>
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

// ---------------- 경기 결과 입력 ----------------

export function ResultEditor({ rule, ruleLabel, m, rd, prev, note: prevNote, showNote, onSave, onClose }: {
  rule: MatchRule;
  ruleLabel: string;
  m: ResolvedMatch;
  rd: ResolvedDivision;
  prev?: MatchResult;
  /** 관리자 메모(비공개). 심판 화면에서는 쓰지 않음 */
  note?: string;
  showNote: boolean;
  onSave: (r: MatchResult | null, action: string, note?: string) => void;
  onClose: () => void;
}) {
  const isSets = rule.mode === 'sets';
  const need = rule.setsToWin ?? 2;
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
  const [note, setNote] = useState(prevNote ?? '');

  const A = whoText(m.sideA);
  const B = whoText(m.sideB);
  const drawAllowed = m.stage === 'group' && !isSets && !!rule.allowDraw;

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
    ...(prev?.replays ? { replays: prev.replays } : {}),
    at: Date.now(),
  };
  const err = checkResult(rule, r, drawAllowed);

  // 이 경기 결과에 따라 정해지는 다음 경기에 이미 결과가 있으면 경고
  const downstream = rd.matches.filter((x) => [x.a, x.b].some((s) => (s.t === 'win' || s.t === 'lose') && s.m === m.id) && x.result);
  const confirmDownstream = () =>
    !downstream.length || confirm(`다음 경기(${downstream.map((x) => x.label).join(', ')})에 이미 결과가 있습니다.\n승자가 바뀌면 그 경기 결과도 확인하세요. 계속할까요?`);

  const submit = () => {
    if (err) return;
    if (has && !confirmDownstream()) return;
    onSave(r, has ? '경기 결과 수정' : '경기 결과 입력', showNote ? note.trim() : undefined);
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="경기 결과 입력">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>{m.label}</h2>
          <button className="btn-sm" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <p className="muted small">{ruleLabel}{prev?.replays ? ` · 재경기 ${prev.replays}회째` : ''}</p>

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
        {showNote && (
          <div className="field">
            <label>메모 (관리자만 보임)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 우천으로 3세트 생략" />
          </div>
        )}

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
