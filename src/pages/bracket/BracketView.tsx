// 대진표 표시(관리자·공개 화면 공용). 배점·종목 최종 순위는 여기서 보여주지 않는다.
import type { ReactNode } from 'react';
import type { ClassId } from '../../config/types';
import {
  BYE,
  groupName,
  roundName,
  slotText,
  type Division,
  type ResolvedDivision,
  type ResolvedMatch,
  type Who,
} from '../../lib/bracket';

export const whoText = (w: Who, fallback = '미정') => (w === BYE ? '부전승' : w ?? fallback);

const STATUS: Record<ResolvedMatch['status'], [string, string]> = {
  waiting: ['대기', 'badge'],
  ready: ['경기 전', 'badge badge-primary'],
  done: ['종료', 'badge badge-ok'],
  bye: ['부전승', 'badge'],
};

export function scoreText(m: ResolvedMatch): string {
  const r = m.result;
  if (m.status === 'bye') return '';
  if (!r) return 'vs';
  if (r.forfeit) return r.forfeit === 'a' ? '기권 : 승' : '승 : 기권';
  return `${r.a} : ${r.b}`;
}

export function MatchBox({ m, rd, onClick }: { m: ResolvedMatch; rd: ResolvedDivision; onClick?: (m: ResolvedMatch) => void }) {
  const labelOf = (id: string) => rd.byId[id]?.label ?? id;
  const side = (w: Who, s: ResolvedMatch['a'], won: boolean) => (
    <div className={`mb-side ${won ? 'mb-win' : ''} ${w === BYE ? 'muted' : ''}`}>{w === null ? <span className="muted">{slotText(s, labelOf)}</span> : whoText(w)}</div>
  );
  const clickable = !!onClick && (m.status === 'ready' || m.status === 'done');
  const r = m.result;
  return (
    <div className={`mb ${clickable ? 'mb-click' : ''} mb-${m.status}`} onClick={clickable ? () => onClick!(m) : undefined}
      role={clickable ? 'button' : undefined} tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => e.key === 'Enter' && onClick!(m) : undefined}>
      <div className="mb-head">
        <span>{m.label}</span>
        <span className={STATUS[m.status][1]}>{STATUS[m.status][0]}</span>
      </div>
      <div className="mb-body">
        {side(m.sideA, m.a, m.outcome === 'a')}
        <div className="mb-score">{scoreText(m)}</div>
        {side(m.sideB, m.b, m.outcome === 'b')}
      </div>
      {r && (r.sets?.length || r.tbWinner || r.replays) ? (
        <div className="mb-extra">
          {r.sets?.length ? r.sets.map(([x, y]) => `${x}-${y}`).join(', ') : ''}
          {r.tbWinner && r.a === r.b ? ' (승부 결정전)' : ''}
          {r.replays ? ` · 재경기 ${r.replays}회` : ''}
        </div>
      ) : null}
      {!r && m.status === 'ready' && onClick ? <div className="mb-extra">눌러서 결과 입력</div> : null}
    </div>
  );
}

/** 조별 순위표 + 경기 목록 */
export function GroupsView({ div, rd, onMatch, extra }: {
  div: Division;
  rd: ResolvedDivision;
  onMatch?: (m: ResolvedMatch) => void;
  extra?: (g: number) => ReactNode;
}) {
  return (
    <>
      {div.groups.map((members, g) => {
        const st = rd.standings[g];
        const ms = rd.matches.filter((m) => m.stage === 'group' && m.group === g);
        return (
          <div key={g} className="card">
            <h3>
              {div.format === 'round_robin' ? '리그 순위표' : `${groupName(g)}조`}{' '}
              <span className="muted small">({members.length}학급{st?.complete ? ' · 조 경기 끝' : ''})</span>
            </h3>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>순</th><th>학급</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>득</th><th>실</th><th>차</th><th>승점</th>
                  </tr>
                </thead>
                <tbody>
                  {st?.rows.map((r, i) => (
                    <tr key={r.id}>
                      <td>{i + 1}{r.tied && st.complete ? <span title="동률" className="tied">=</span> : null}</td>
                      <td><b>{r.id}</b></td>
                      <td>{r.played}</td><td>{r.w}</td><td>{r.d}</td><td>{r.l}</td><td>{r.gf}</td><td>{r.ga}</td><td>{r.gf - r.ga}</td>
                      <td><b>{r.pts}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {extra?.(g)}
            <div className="mb-grid">
              {ms.map((m) => <MatchBox key={m.id} m={m} rd={rd} onClick={onMatch} />)}
            </div>
          </div>
        );
      })}
    </>
  );
}

/** 토너먼트 대진표(라운드별 세로 줄) */
export function KnockoutView({ div, rd, onMatch }: { div: Division; rd: ResolvedDivision; onMatch?: (m: ResolvedMatch) => void }) {
  const ko = rd.matches.filter((m) => m.stage === 'ko');
  if (!ko.length) return null;
  const rounds = Math.max(...ko.map((m) => m.round));
  const third = rd.matches.find((m) => m.stage === 'third');
  const final = ko.find((m) => m.round === rounds);
  const champion = final?.winner && final.winner !== BYE ? final.winner : null;
  return (
    <div className="card">
      <h3>{div.format === 'groups_knockout' ? '본선 토너먼트' : '토너먼트'}</h3>
      <div className="ko">
        {Array.from({ length: rounds }, (_, i) => i + 1).map((r) => (
          <div key={r} className="ko-col">
            <div className="ko-title">{roundName(div.koSlots.length / 2 ** (r - 1))}</div>
            <div className="ko-list">
              {ko.filter((m) => m.round === r).map((m) => <MatchBox key={m.id} m={m} rd={rd} onClick={onMatch} />)}
            </div>
          </div>
        ))}
        <div className="ko-col">
          <div className="ko-title">우승</div>
          <div className="ko-list">
            <div className="ko-champ">{champion ? `🏆 ${champion}` : '?'}</div>
          </div>
        </div>
      </div>
      {third && (
        <div style={{ maxWidth: 260, marginTop: 8 }}>
          <MatchBox m={third} rd={rd} onClick={onMatch} />
        </div>
      )}
    </div>
  );
}

/** 순위제: 조(함께 뛰는 묶음)와 기록 */
export function HeatsView({ div, records, rankMode }: { div: Division; records: Record<ClassId, number>; rankMode?: boolean }) {
  return (
    <div className="card">
      <h3>조 편성 · 기록</h3>
      {div.heats.map((h, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          <div className="small"><b>{div.heats.length > 1 ? `${i + 1}조` : '전체'}</b></div>
          <div className="row">
            {h.map((c) => (
              <span key={c} className="chip">
                {c}
                {records[c] != null && <b> · {records[c]}{rankMode ? '위' : ''}</b>}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
