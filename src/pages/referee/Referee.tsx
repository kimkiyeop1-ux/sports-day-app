// 심판 입력 화면 (#/ref/{종목}/{토큰})
// 관리자가 나눠 준 링크로 들어와 6자리 PIN + 이름을 넣으면, 그 종목의 경기 결과만 입력할 수 있다.
// 읽는 데이터: 공개 문서(public/info, public/bracket_{종목}, public/results_{종목}) + 자기 심판 세션. 배점은 전혀 내려받지 않는다.
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { doc, setDoc } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { auth, db, isConfigured } from '../../lib/firebase';
import { useActiveTournament, useAuthUser, useDoc, useJsonDoc, useOnline } from '../../data/hooks';
import {
  isBlind,
  paths,
  readResults,
  writeMatchResult,
  writeRecords,
  type BlindDoc,
  type PublicBracketData,
  type RefSessionDoc,
  type ResultsDoc,
} from '../../data/store';
import type { PublicInfo } from '../../config/derive';
import { resolveDivision, type Division, type ResolvedDivision, type ResolvedMatch, type Results } from '../../lib/bracket';
import { GroupsView, KnockoutView, MatchBox, whoText } from '../bracket/BracketView';
import { RecordEditor, ResultEditor } from '../bracket/Editors';

const NAME_KEY = 'sportsday.refName';

// 익명 로그인은 한 번만(화면이 다시 그려져도 새 계정이 생기지 않도록)
let anonSignIn: Promise<unknown> | null = null;
export function ensureAnon(): Promise<unknown> {
  if (!anonSignIn) anonSignIn = signInAnonymously(auth).catch((e) => {
    anonSignIn = null;
    throw e;
  });
  return anonSignIn;
}

export default function Referee() {
  const { eventId = '', token = '' } = useParams();
  const { tid, loading: tidLoading } = useActiveTournament();
  const { user, ready } = useAuthUser();
  const [authErr, setAuthErr] = useState<string | null>(null);

  // 심판 기기는 익명 로그인(개인정보 없음)
  useEffect(() => {
    if (isConfigured && ready && !user)
      ensureAnon().catch((e: any) =>
        setAuthErr(e.code === 'auth/operation-not-allowed' ? '이 학교 Firebase에서 익명 로그인이 꺼져 있습니다. 관리자에게 알려 주세요.' : e.code ?? e.message),
      );
  }, [ready, user]);

  const sess = useDoc<RefSessionDoc>(tid && user ? paths.refSession(tid, user.uid) : null);
  const [revoked, setRevoked] = useState(false);
  // 서버가 PIN을 확인하기 전(전송 중)에는 아직 들어가지 않는다
  const valid = !!sess.data && !sess.pending && sess.data.ev === eventId && sess.data.token === token && !revoked;

  if (!isConfigured)
    return <div className="page"><div className="alert alert-warn">학교 연결 정보가 없습니다. 관리자에게 받은 링크를 그대로 열어 주세요.</div></div>;
  if (authErr) return <div className="page"><div className="alert alert-danger">로그인 실패: {authErr}</div></div>;
  if (!ready || !user || tidLoading || sess.loading) return <div className="page muted">불러오는 중…</div>;
  if (!tid) return <div className="page"><div className="alert alert-warn">진행 중인 대회가 없습니다.</div></div>;

  if (!valid)
    return <PinForm tid={tid} uid={user.uid} eventId={eventId} token={token} revoked={revoked} onDone={() => setRevoked(false)} />;
  return <RefBoard tid={tid} eventId={eventId} name={sess.data!.name} onRevoked={() => setRevoked(true)} />;
}

export function PinForm({ tid, uid, eventId, token, revoked, onDone, title, heading = '🧑‍⚖️ 심판 입력' }: {
  tid: string; uid: string; eventId: string; token: string; revoked: boolean; onDone: () => void; title?: string; heading?: string;
}) {
  const info = useDoc<PublicInfo>(paths.publicInfo(tid));
  const evName = title ?? info.data?.events.find((e) => e.id === eventId)?.name ?? eventId;
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(revoked ? '관리자가 PIN을 바꿨습니다. 새 PIN을 입력하세요.' : null);
  const online = useOnline();

  const submit = async () => {
    if (!online) return setErr('인터넷에 연결된 상태에서 처음 한 번 PIN을 확인해야 합니다.');
    setBusy(true);
    setErr(null);
    try {
      await setDoc(doc(db, paths.refSession(tid, uid)), { ev: eventId, token, pin, name: name.trim(), at: Date.now() } satisfies RefSessionDoc);
      try {
        localStorage.setItem(NAME_KEY, name.trim());
      } catch {
        /* 무시 */
      }
      onDone();
    } catch (e: any) {
      setErr(e?.code === 'permission-denied' ? 'PIN이 맞지 않거나, 링크가 새로 바뀌었습니다. 관리자에게 확인하세요.' : '확인 실패: ' + (e?.code ?? e?.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 480 }}>
      <h1>{heading}</h1>
      <div className="card stack">
        <p style={{ fontSize: 20, margin: 0 }}><b>{evName}</b></p>
        <p className="muted small">처음 한 번만 이름과 PIN을 넣으면 됩니다. 이 기기에 기억됩니다.</p>
        <div className="field">
          <label>선생님 이름 (결과 기록에 남습니다)</label>
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="예: 김체육" />
        </div>
        <div className="field">
          <label>PIN 6자리</label>
          <input value={pin} inputMode="numeric" maxLength={6} autoComplete="one-time-code"
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))} style={{ fontSize: 24, letterSpacing: 6, textAlign: 'center' }} />
        </div>
        {err && <div className="alert alert-danger">{err}</div>}
        <button className="btn-primary" disabled={busy || pin.length !== 6 || !name.trim()} onClick={submit} style={{ fontSize: 18 }}>
          {busy ? '확인 중…' : '시작하기'}
        </button>
      </div>
    </div>
  );
}

function RefBoard({ tid, eventId, name, onRevoked }: { tid: string; eventId: string; name: string; onRevoked: () => void }) {
  const br = useJsonDoc<PublicBracketData>(paths.publicBracket(tid, eventId));
  const rs = useDoc<ResultsDoc>(paths.results(tid, eventId));
  const bl = useDoc<BlindDoc>(paths.blind(tid));
  const blind = isBlind(bl.data, eventId);
  const hs = useDoc<ResultsDoc>(blind ? paths.hidden(tid, eventId) : null);
  const online = useOnline();
  const data = br.data;
  const { results, records } = useMemo(() => readResults(rs.data, data, blind ? hs.data : null), [rs.data, data, blind, hs.data]);
  const ev = { id: eventId, name: data?.eventName ?? eventId };

  const fail = (e: any) => {
    if (e?.code === 'permission-denied') {
      alert('저장이 거부되었습니다. 관리자가 PIN을 바꿨을 수 있습니다. PIN을 다시 입력하세요.');
      onRevoked();
    } else alert('저장 실패: ' + (e?.code ?? e?.message));
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <span className="title">🧑‍⚖️ {ev.name}</span>
          <span className="grow" />
          <span className={`sync ${!online ? 'sync-off' : rs.pending ? 'sync-pending' : 'sync-ok'}`}>
            {!online ? '오프라인 · 기기에 저장 중' : rs.pending ? '전송 중…' : '실시간 연결됨'}
          </span>
        </div>
      </div>
      <div className="page">
        <p className="muted small">입력자: <b>{name}</b> · 넣은 결과는 바로 학생 화면에 나오고, 누가 넣었는지 기록돼요.</p>
        {!online && <div className="alert alert-warn">인터넷이 끊겼습니다. 입력은 이 기기에 저장되었다가 다시 연결되면 자동으로 전송됩니다.</div>}
        {blind && <div className="alert alert-warn">🙈 지금은 결과를 숨기는 중이에요. 넣은 결과는 폐회식 때 공개돼요. 평소처럼 넣으면 돼요.</div>}
        {br.loading || rs.loading || bl.loading || hs.loading ? (
          <p className="muted">불러오는 중…</p>
        ) : !data || data.divisions.length === 0 ? (
          <div className="card muted">아직 대진표가 만들어지지 않았습니다. 관리자에게 알려 주세요.</div>
        ) : (
          data.divisions.map((d) => (
            <RefDivision key={d.key} tid={tid} ev={ev} data={data} div={d} results={results} records={records[d.key] ?? {}}
              multi={data.divisions.length > 1} actor={{ name }} fail={fail} blind={blind} />
          ))
        )}
      </div>
    </>
  );
}

function RefDivision({ tid, ev, data, div, results, records, multi, actor, fail, blind }: {
  tid: string;
  ev: { id: string; name: string };
  data: PublicBracketData;
  div: Division;
  results: Results;
  records: Record<string, number>;
  multi: boolean;
  actor: { name: string };
  fail: (e: unknown) => void;
  blind: boolean;
}) {
  const [open, setOpen] = useState<ResolvedMatch | null>(null);
  const [showAll, setShowAll] = useState(false);
  const rd: ResolvedDivision = useMemo(
    () => resolveDivision(div, results, data.leaguePoints, data.groupOrder?.[div.key]),
    [div, results, data.leaguePoints, data.groupOrder],
  );
  const ruleLabel = data.rule.mode === 'sets' ? `${(data.rule.setsToWin ?? 2) * 2 - 1}판 ${data.rule.setsToWin ?? 2}선승` : data.rule.allowDraw ? '점수제(무승부 가능)' : '점수제';

  if (div.format === 'ranking')
    return (
      <div className="division">
        {multi && <h2>{div.title}</h2>}
        <RecordEditor div={div} records={records} rankBy={data.rankBy}
          onSave={(rec) => writeRecords(tid, ev, div.key, div.title, records, rec, actor, blind).catch(fail)} />
      </div>
    );

  const ready = rd.matches.filter((m) => m.status === 'ready');
  const done = rd.matches.filter((m) => m.status === 'done');
  const waiting = rd.matches.filter((m) => m.status === 'waiting');

  return (
    <div className="division">
      {multi && <h2>{div.title}</h2>}
      <div className="card">
        <h3>입력할 경기 <span className="badge badge-primary">{ready.length}</span></h3>
        {ready.length === 0 ? (
          <p className="muted small">{waiting.length ? '앞 경기 결과를 기다리는 중입니다.' : '모든 경기가 끝났습니다. 👏'}</p>
        ) : (
          <div className="mb-grid">{ready.map((m) => <MatchBox key={m.id} m={m} rd={rd} onClick={setOpen} />)}</div>
        )}
      </div>
      {done.length > 0 && (
        <div className="card">
          <h3>끝난 경기 <span className="muted small">(눌러서 고치기)</span></h3>
          <div className="mb-grid">{[...done].reverse().map((m) => <MatchBox key={m.id} m={m} rd={rd} onClick={setOpen} />)}</div>
        </div>
      )}
      <button className="btn-sm" onClick={() => setShowAll(!showAll)}>{showAll ? '전체 대진표 닫기' : '전체 대진표·순위표 보기'}</button>
      {showAll && (
        <div style={{ marginTop: 12 }}>
          {div.groups.length > 0 && <GroupsView div={div} rd={rd} onMatch={setOpen} />}
          <KnockoutView div={div} rd={rd} onMatch={setOpen} />
        </div>
      )}
      {open && (
        <ResultEditor rule={data.rule} ruleLabel={ruleLabel} m={rd.byId[open.id] ?? open} rd={rd} prev={results[open.id]} showNote={false}
          onClose={() => setOpen(null)}
          onSave={(r, action) => {
            const m = rd.byId[open.id];
            writeMatchResult(tid, ev, open.id, `${div.title} ${m.label} (${whoText(m.sideA)} vs ${whoText(m.sideB)})`, action, results[open.id] ?? null, r, actor, blind).catch(fail);
            setOpen(null);
          }} />
      )}
    </div>
  );
}
