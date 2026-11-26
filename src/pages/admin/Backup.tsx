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
  rehearsalId,
  resetTournament,
  startRehearsal,
  type BonusDoc,
  type BracketData,
  type JsonDoc,
  type ResultsDoc,
} from '../../data/store';
import type { TournamentConfig } from '../../config/types';
import { allClasses } from '../../config/derive';
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
  if (!config || !tid) return <p>먼저 대시보드에서 대회를 시작하세요.</p>;
  return (
    <>
      <h1>백업 · 리허설 · 초기화</h1>
      <ExportSection tid={tid} config={config} />
      <RehearsalSection config={config} />
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

  const bonusCsv = () => {
    const cats = config.scoring.bonusCategories;
    download(name('bonus-points'), toCsv([['학급', ...cats.map((c) => c.name + (c.negative ? '(감점)' : ''))], ...allClasses(config).map((c) => [c, ...cats.map((k) => bonus[k.id]?.[c] ?? 0)])]));
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
      <h2>📥 백업 내려받기</h2>
      <p className="muted small" style={{ margin: 0 }}>엑셀에서 열 수 있는 CSV 파일입니다. 🔒 종합 순위·점수 파일은 학생에게 공유하지 마세요. 대회가 끝나면 모두 내려받아 보관하는 것을 권장합니다.</p>
      {loading ? (
        <p className="muted">불러오는 중…</p>
      ) : (
        <div className="row">
          <button onClick={matchesCsv}>경기 결과 CSV</button>
          <button onClick={standingsCsv}>🔒 종합 순위·점수 CSV</button>
          <button onClick={bonusCsv}>🔒 경기 외 점수 CSV</button>
          <button onClick={auditCsv}>변경 이력 CSV</button>
          <button className="btn-primary" disabled={busy} onClick={jsonBackup}>{busy ? '모으는 중…' : '전체 백업(JSON)'}</button>
        </div>
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
        <h2>🎭 리허설 중</h2>
        <p className="small" style={{ margin: 0 }}>
          지금은 <b>리허설 대회</b>입니다. 마음껏 결과를 넣고 블라인드·발표까지 연습하세요. 진짜 대회(<code>{config.rehearsalOf}</code>) 기록에는 영향이 없습니다.
          전광판·공개 대진표 제목에도 [리허설]이 붙습니다.
        </p>
        <div className="row">
          <button className="btn-primary" disabled={busy} onClick={() => confirm('리허설을 끝내고 진짜 대회로 돌아갈까요?') && run(() => endRehearsal(config))}>리허설 끝내기</button>
          <button disabled={busy} onClick={() => confirm('리허설 기록을 모두 지우고 처음부터 다시 연습할까요?') && run(() => resetTournament(config.id, config))}>리허설 기록 지우고 다시</button>
        </div>
      </div>
    );
  return (
    <div className="card stack">
      <h2>🎭 리허설 모드</h2>
      <p className="muted small" style={{ margin: 0 }}>
        지금 대회 설정을 그대로 복사한 '연습용 대회'로 바꿉니다. 대진표 만들기 → 심판 입력 → 블라인드 → 순위 발표까지 실제처럼 연습할 수 있고,
        끝내면 진짜 대회 기록은 그대로입니다. 심판·진행자 링크도 같은 링크를 쓸 수 있습니다(처음 한 번 PIN 다시 입력).
      </p>
      <p className="muted small" style={{ margin: 0 }}>리허설 대회 ID: <code>{rehearsalId(config.id)}</code> · 리허설 중 대회 설정을 바꾸면 리허설에만 적용됩니다.</p>
      <button disabled={busy} onClick={() => confirm('리허설을 시작할까요?\n지난 리허설 기록이 있으면 지워지고 새로 시작합니다.') && run(() => startRehearsal(config))}>
        {busy ? '준비 중…' : '리허설 시작'}
      </button>
    </div>
  );
}

function ResetSection({ tid, config }: { tid: string; config: TournamentConfig }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const reset = async () => {
    if (!confirm(`정말로 "${config.title}" 기록을 모두 지울까요?\n먼저 전체 백업 파일이 자동으로 내려받아집니다.\n\n되돌릴 수 없습니다.`)) return;
    setBusy(true);
    try {
      const data = await collectBackup(tid, config);
      download(`${config.id}_before-reset_${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
      await resetTournament(tid, config);
      setTyped('');
      setDone(true);
    } catch (e: any) {
      alert('초기화 실패: ' + e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card stack" style={{ borderColor: 'var(--danger)' }}>
      <h2>🧹 전체 초기화</h2>
      <p className="small" style={{ margin: 0 }}>
        대회 설정(학급·종목·배점·시나리오)과 심판·진행자 링크는 남기고, <b>시나리오 진행 기록·대진표·경기 결과·경기 외 점수·블라인드·발표 자료·심판 접속 기록·변경 이력</b>을 모두 지웁니다.
        지우기 전에 전체 백업(JSON)이 자동으로 내려받아집니다.
      </p>
      <label className="small" style={{ margin: 0 }}>
        확인을 위해 대회 ID <code>{config.id}</code> 를 그대로 입력하세요
      </label>
      <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={config.id} aria-label="대회 ID 확인" />
      <button className="btn-danger" disabled={busy || typed.trim() !== config.id} onClick={reset}>{busy ? '지우는 중…' : '전체 초기화'}</button>
      {done && <div className="alert alert-ok">초기화했습니다. 백업 파일을 잘 보관하세요.</div>}
    </div>
  );
}
