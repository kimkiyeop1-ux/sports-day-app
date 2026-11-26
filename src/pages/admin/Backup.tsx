// 관리자: CSV·전체 백업, 리허설 모드, 전체 초기화
import { useMemo, useState } from 'react';
import { useAdmin } from './AdminLayout';
import { useEventRanks } from './Scores';
import { useCollection, useDoc, useDocs } from '../../data/hooks';
import {
  collectBackup,
  endRehearsal,
  leaguePointsOf,
  parseJsonDoc,
  paths,
  readResults,
  resetTournament,
  startRehearsal,
  type BonusDoc,
  type BracketData,
  type JsonDoc,
  type ResultsDoc,
} from '../../data/store';
import type { TournamentConfig } from '../../config/types';
import { BYE, resolveDivision, type ResolvedMatch } from '../../lib/bracket';
import { computeScores, rankByScope } from '../../lib/scoring';
import { download, stamp, toCsv, type Cell } from '../../lib/csv';

interface AuditDoc {
  at: number;
  actorName: string;
  action: string;
  target: string;
  before: string;
  after: string;
}

export default function Backup() {
  const { tid, config } = useAdmin();
  if (!config || !tid) return <p>먼저 홈에서 대회를 시작하세요.</p>;
  return (
    <>
      <h1>연습 모드 · 파일로 저장</h1>
      <RehearsalSection config={config} />
      <ExportSection tid={tid} config={config} />
      <ResetSection tid={tid} config={config} />
    </>
  );
}

const who = (w: unknown) => (w === BYE ? '부전승' : (w as string | null) ?? '');

function outcomeNote(m: ResolvedMatch): string {
  const r = m.result;
  const notes: string[] = [];
  if (m.status === 'bye') notes.push('부전승');
  if (r?.forfeit) notes.push(`${r.forfeit === 'a' ? who(m.sideA) : who(m.sideB)} 기권`);
  if (r?.tbWinner && r.a === r.b) notes.push('동점 승부 결정');
  if (r && !r.forfeit && r.a === r.b && !r.tbWinner && r.a != null) notes.push('무승부');
  if (r?.replays) notes.push(`재경기 ${r.replays}회`);
  return notes.join(' / ');
}

const STATUS: Record<string, string> = { waiting: '대기', ready: '경기 전', done: '종료', bye: '부전승' };

function ExportSection({ tid, config }: { tid: string; config: TournamentConfig }) {
  const evPaths = useMemo(
    () => config.events.flatMap((e) => [paths.bracket(tid, e.id), paths.results(tid, e.id), paths.hidden(tid, e.id)]),
    [tid, config],
  );
  const docs = useDocs<JsonDoc | ResultsDoc>(evPaths);
  const bonusDoc = useDoc<BonusDoc>(paths.bonus(tid));
  const audit = useCollection<AuditDoc>(paths.audit(tid), 'at', 5000);
  const { ranksByEvent } = useEventRanks(tid, config, docs.data);
  const [busy, setBusy] = useState(false);
  // 파일 이름은 영문으로(한글 파일 이름은 일부 브라우저에서 'download'로 바뀌어 확장자가 사라짐)
  const name = (what: string) => `${config.id}_${what}_${stamp()}.csv`;
  const bonus = bonusDoc.data?.v ?? {};

  const matchesCsv = () => {
    const rows: Cell[][] = [['종목', '대진', '경기', '학급A', '학급B', 'A점수', 'B점수', '세트 점수', '승자', '상태', '비고']];
    const recRows: Cell[][] = [];
    for (const ev of config.events) {
      const br = parseJsonDoc<BracketData>(docs.data[paths.bracket(tid, ev.id)] as JsonDoc | null);
      if (!br) continue;
      const { results, records } = readResults(
        (docs.data[paths.results(tid, ev.id)] as ResultsDoc | null) ?? null,
        br,
        (docs.data[paths.hidden(tid, ev.id)] as ResultsDoc | null) ?? null,
      );
      for (const d of br.divisions) {
        if (d.format === 'ranking') {
          d.heats.forEach((h, i) => h.forEach((c) => recRows.push([ev.name, d.title, d.heats.length > 1 ? `${i + 1}조` : '전체', c, records[d.key]?.[c] ?? ''])));
          continue;
        }
        const rd = resolveDivision(d, results, leaguePointsOf(ev), br.groupOrder?.[d.key]);
        for (const m of rd.matches) {
          const r = m.result;
          rows.push([
            ev.name, d.title, m.label, who(m.sideA), who(m.sideB),
            r && !r.forfeit ? r.a : '', r && !r.forfeit ? r.b : '',
            r?.sets?.map((s) => s.join('-')).join(' ') ?? '',
            m.outcome === 'draw' ? '무승부' : who(m.winner), STATUS[m.status], outcomeNote(m),
          ]);
        }
      }
    }
    if (recRows.length) rows.push([], ['종목', '대진', '조', '학급', '기록(순위제)'], ...recRows);
    download(name('match-results'), toCsv(rows));
  };

  const standingsCsv = () => {
    const rows = computeScores(config, ranksByEvent, bonus, config.scoring.sharedRankPoints ?? 'same');
    const grades = config.grades.map((g) => g.grade).sort((a, b) => a - b);
    const scopes: [string, number | null][] = [...(grades.length > 1 ? [['전교', null] as [string, null]] : []), ...grades.map((g) => [`${g}학년`, g] as [string, number])];
    const head: Cell[] = ['범위', '순위', '공동', '학급', ...config.events.flatMap((e) => [`${e.name} 순위`, `${e.name} 점수`]), ...config.scoring.bonusCategories.map((c) => c.name + (c.negative ? '(감점)' : '')), '경기 점수 합', '경기 외 합', '총점'];
    const out: Cell[][] = [head];
    for (const [label, g] of scopes) {
      for (const r of rankByScope(rows, config, g)) {
        out.push([
          label, r.rank, r.shared ? '공동' : '', r.id,
          ...config.events.flatMap((e) => (r.events[e.id] ? [r.events[e.id].rank ?? '미정', r.events[e.id].points] : ['', ''])),
          ...config.scoring.bonusCategories.map((c) => r.bonus[c.id] ?? 0),
          r.eventTotal, r.bonusTotal, r.total,
        ]);
      }
    }
    download(name('standings'), toCsv(out));
  };

  const auditCsv = () => {
    const t = (ms: number) => new Date(ms).toLocaleString('ko-KR');
    download(name('history'), toCsv([['시각', '입력자', '내용', '대상', '이전', '이후'], ...[...audit.docs].reverse().map((a) => [t(a.at), a.actorName, a.action, a.target, a.before, a.after])]));
  };

  const jsonBackup = async () => {
    setBusy(true);
    try {
      const data = await collectBackup(tid, config);
      download(`${config.id}_full-backup_${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
    } catch (e: any) {
      alert('백업 실패: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const loading = docs.loading || bonusDoc.loading || audit.loading;
  return (
    <div className="card stack">
      <h2>💾 파일로 저장</h2>
      <p className="small" style={{ margin: 0 }}>대회가 끝나면 엑셀 파일로 받아 두세요. 🔒 점수표는 학생에게 보여 주지 마세요.</p>
      {loading ? (
        <p className="muted">불러오는 중…</p>
      ) : (
        <>
          <div className="row">
            <button className="btn-primary" onClick={matchesCsv}>경기 결과 (엑셀)</button>
            <button className="btn-primary" onClick={standingsCsv}>🔒 반별 점수표 (엑셀)</button>
          </div>
          <details>
            <summary className="small muted">선생님용: 모든 기록을 한 파일로 (복구용)</summary>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn-sm" disabled={busy} onClick={jsonBackup}>{busy ? '모으는 중…' : '전체 저장 파일 (.json)'}</button>
              <button className="btn-sm" onClick={auditCsv}>고친 기록 (엑셀)</button>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function RehearsalSection({ config }: { config: TournamentConfig }) {
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } catch (e: any) {
      alert('실패: ' + e.message);
    } finally {
      setBusy(false);
    }
  };
  if (config.rehearsalOf)
    return (
      <div className="card stack" style={{ borderColor: '#f59e0b' }}>
        <h2>🎭 지금은 연습 모드예요</h2>
        <p className="small" style={{ margin: 0 }}>
          마음껏 눌러 보세요. 여기서 넣은 결과와 점수는 <b>진짜 대회에 남지 않아요.</b> 전광판 제목 앞에도 [리허설]이 붙어요.
        </p>
        <div className="row">
          <button className="btn-primary" disabled={busy} onClick={() => confirm('연습을 끝내고 진짜 대회로 돌아갈까요?') && run(() => endRehearsal(config))}>연습 끝내기</button>
          <button disabled={busy} onClick={() => confirm('연습한 기록을 모두 지우고 처음부터 다시 연습할까요?') && run(() => resetTournament(config.id, config))}>연습 기록 지우고 다시</button>
        </div>
      </div>
    );
  return (
    <div className="card stack">
      <h2>🎭 연습 모드</h2>
      <p className="small" style={{ margin: 0 }}>
        대회 날 전에 <b>미리 해 보는 연습판</b>이에요. 우리 대회를 똑같이 복사해서, 대진표·심판 입력·점수·순위 발표까지 마음껏 눌러 볼 수 있어요.
        연습을 끝내면 진짜 대회는 <b>아무것도 바뀌지 않은 그대로</b>예요.
      </p>
      <div>
        <button className="btn-primary" disabled={busy} onClick={() => confirm('연습 모드를 시작할까요?\n전에 연습한 기록이 있으면 지우고 새로 시작해요.') && run(() => startRehearsal(config))}>
          {busy ? '준비 중…' : '연습 시작하기'}
        </button>
      </div>
    </div>
  );
}

function ResetSection({ tid, config }: { tid: string; config: TournamentConfig }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const reset = async () => {
    if (!confirm(`정말로 "${config.title}" 기록을 모두 지울까요?\n지우기 전에 저장 파일이 자동으로 내려받아져요.\n\n되돌릴 수 없어요.`)) return;
    setBusy(true);
    try {
      const data = await collectBackup(tid, config);
      download(`${config.id}_before-reset_${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
      await resetTournament(tid, config);
      setTyped('');
      setDone(true);
    } catch (e: any) {
      alert('지우지 못했어요: ' + e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="card">
      <summary style={{ cursor: 'pointer' }}><b>🧹 처음부터 다시 하기</b> <span className="muted small">(조심!)</span></summary>
      <div className="stack" style={{ marginTop: 10 }}>
        <p className="small" style={{ margin: 0 }}>
          대회 정보(반·종목·점수표·진행표)와 심판 링크는 남기고, <b>경기 결과·점수·진행 기록·고친 기록</b>을 모두 지워요. 지우기 전에 저장 파일이 자동으로 내려받아져요.
        </p>
        <label className="small" style={{ margin: 0 }}>정말 지우려면 아래 칸에 <b>지우기</b>라고 써 주세요</label>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="지우기" aria-label="지우기 확인" />
        <div><button className="btn-danger" disabled={busy || typed.trim() !== '지우기'} onClick={reset}>{busy ? '지우는 중…' : '모두 지우기'}</button></div>
        {done && <div className="alert alert-ok">다 지웠어요. 내려받은 저장 파일은 잘 보관하세요.</div>}
      </div>
    </details>
  );
}
