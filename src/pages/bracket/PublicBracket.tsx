// 공개 대진표(학생·학부모·전광판용, 로그인 없음)
// 읽는 데이터: meta/active, public/info, public/bracket_{종목}, public/results_{종목} 뿐 — 배점·총점·종목 순위 없음
import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useActiveTournament, useDoc, useJsonDoc, useOnline } from '../../data/hooks';
import { isBlind, paths, readResults, type BlindDoc, type PublicBracketData, type ResultsDoc } from '../../data/store';
import type { PublicInfo } from '../../config/derive';
import { resolveDivision } from '../../lib/bracket';
import { isConfigured } from '../../lib/firebase';
import { GroupsView, HeatsView, KnockoutView } from './BracketView';

export default function PublicBracket() {
  const { eventId } = useParams();
  const nav = useNavigate();
  const { tid } = useActiveTournament();
  const info = useDoc<PublicInfo>(tid ? paths.publicInfo(tid) : null);
  const events = info.data?.events ?? [];
  const ev = events.find((e) => e.id === eventId) ?? events[0];
  const br = useJsonDoc<PublicBracketData>(tid && ev ? paths.publicBracket(tid, ev.id) : null);
  const rs = useDoc<ResultsDoc>(tid && ev ? paths.results(tid, ev.id) : null);
  const bl = useDoc<BlindDoc>(tid ? paths.blind(tid) : null);
  const online = useOnline();

  if (!isConfigured) return <div className="page">학교 Firebase가 연결되지 않았습니다. <Link to="/connect">학교 연결</Link></div>;

  return (
    <div className="page wide">
      <div className="row" style={{ marginBottom: 8 }}>
        <h1 className="grow" style={{ margin: 0 }}>📋 대진표 · 경기 결과</h1>
        <span className="muted small">{online ? (br.fromCache ? '연결 중…' : '● 실시간') : '⚠ 오프라인'}</span>
      </div>
      <p className="muted small">{info.data?.title}</p>
      <div className="row" style={{ marginBottom: 12 }}>
        {events.map((e) => (
          <button key={e.id} className={`btn-sm ${e.id === ev?.id ? 'btn-primary' : ''}`} onClick={() => nav(`/bracket/${e.id}`)}>
            {e.name}
          </button>
        ))}
      </div>
      {ev && <p className="muted small">{ev.matchLabel}{ev.location ? ` · ${ev.location}` : ''}</p>}
      {ev && isBlind(bl.data, ev.id) && (
        <div className="alert alert-warn">🙈 이 종목은 지금부터 결과를 공개하지 않습니다. 남은 결과는 폐회식에서 함께 발표합니다!</div>
      )}
      {info.loading || br.loading || rs.loading ? (
        <p className="muted">불러오는 중…</p>
      ) : !br.data || br.data.divisions.length === 0 ? (
        <div className="card muted">아직 대진표가 발표되지 않았습니다.</div>
      ) : (
        <Divisions data={br.data} rdoc={rs.data} />
      )}
    </div>
  );
}

function Divisions({ data, rdoc }: { data: PublicBracketData; rdoc: ResultsDoc | null }) {
  const { results, records } = useMemo(() => readResults(rdoc, data), [rdoc, data]);
  const resolved = useMemo(
    () => data.divisions.map((d) => ({ d, rd: resolveDivision(d, results, data.leaguePoints, data.groupOrder?.[d.key]) })),
    [data, results],
  );
  return (
    <>
      {resolved.map(({ d, rd }) => (
        <div key={d.key} className="division">
          {resolved.length > 1 && <h2>{d.title}</h2>}
          {d.format === 'ranking' ? (
            <HeatsView div={d} records={records[d.key] ?? {}} rankMode={data.rankBy === 'rank'} />
          ) : (
            <>
              {d.groups.length > 0 && <GroupsView div={d} rd={rd} />}
              <KnockoutView div={d} rd={rd} />
            </>
          )}
        </div>
      ))}
    </>
  );
}
