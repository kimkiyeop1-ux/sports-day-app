// 대회 설정 → 📄 계획서로 만들기
// ① 시간표 붙여넣기(시나리오만, AI 없음)  ② AI 도우미(학급·종목·배점·시나리오 전체)
import { useMemo, useState } from 'react';
import type { TournamentConfig } from '../../config/types';
import { FORMAT_LABELS, matchRuleLabel } from '../../config/derive';
import { buildAiPrompt, extractJson, parseAiConfig, parseScenarioText, type AiResult } from '../../lib/planParse';

export default function PlanImport({ draft, setDraft, onDone }: {
  draft: TournamentConfig;
  setDraft: (c: TournamentConfig) => void;
  /** 적용한 뒤 보여 줄 탭으로 이동 */
  onDone: (tab: 'scenario' | 'events') => void;
}) {
  return (
    <>
      <p className="muted small">
        계획서 내용을 이 화면에 붙여넣어 대회 설정을 만듭니다. 적용한 뒤 각 탭에서 확인하고, 아래 <b>[변경 내용 저장]</b>을 눌러야 실제로 저장됩니다.
      </p>
      <ScheduleCard draft={draft} setDraft={setDraft} onDone={() => onDone('scenario')} />
      <AiCard draft={draft} setDraft={setDraft} onDone={() => onDone('events')} />
    </>
  );
}

// ---------------- ① 시간표 붙여넣기 ----------------

function ScheduleCard({ draft, setDraft, onDone }: { draft: TournamentConfig; setDraft: (c: TournamentConfig) => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseScenarioText(text, draft.events), [text, draft.events]);
  const apply = (mode: 'replace' | 'append') => {
    if (mode === 'replace' && draft.scenario.length && !confirm(`지금 시나리오 ${draft.scenario.length}개를 붙여넣은 ${parsed.items.length}개로 바꿀까요?`)) return;
    const base = mode === 'replace' ? [] : draft.scenario;
    const items = parsed.items.map((it, i) => ({ ...it, id: `s${String(base.length + i + 1).padStart(2, '0')}-${Math.random().toString(36).slice(2, 5)}` }));
    setDraft({ ...draft, scenario: [...base, ...items] });
    setText('');
    onDone();
  };
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>① 시간표 붙여넣기 <span className="badge">시나리오만 · AI 없이</span></h2>
      <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
        <li>계획서(한글·엑셀·PDF)의 <b>진행 시간표</b> 부분을 마우스로 드래그해 복사합니다. 표 그대로 복사해도 됩니다.</li>
        <li>아래 칸에 붙여넣으면 바로 아래에 미리보기가 나옵니다.</li>
      </ol>
      <textarea style={{ minHeight: 140 }} value={text} onChange={(e) => setText(e.target.value)} aria-label="시간표 붙여넣기"
        placeholder={'예)\n08:30~08:50  학생 입장 및 정렬  학년부\n08:50~09:10  개회식  교무부\n9시 10분 준비운동 (10분)\n오후 1:10 - 1:50 | 계주 결승 | 체육부'} />
      {text.trim() && (
        parsed.items.length ? (
          <>
            <div className="table-wrap">
              <table className="tbl" style={{ textAlign: 'left' }}>
                <thead>
                  <tr><th>시각</th><th>분</th><th>순서</th><th>담당</th><th>종목</th><th>메모</th></tr>
                </thead>
                <tbody>
                  {parsed.items.map((it) => (
                    <tr key={it.id}>
                      <td>{it.time}</td>
                      <td>{it.durationMin}</td>
                      <td style={{ textAlign: 'left', whiteSpace: 'normal' }}>{it.title}</td>
                      <td>{it.owner ?? ''}</td>
                      <td>{draft.events.find((e) => e.id === it.eventId)?.name ?? ''}</td>
                      <td className="muted" style={{ textAlign: 'left', whiteSpace: 'normal' }}>{it.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsed.warnings.map((w) => <div key={w} className="alert alert-warn">{w}</div>)}
            <p className="muted small" style={{ margin: 0 }}>틀린 곳은 적용한 뒤 [시나리오] 탭에서 고칠 수 있습니다. 시각이 없는 줄은 바로 위 순서의 메모(방송 멘트)로 들어갑니다.</p>
            <div className="row">
              <button className="btn-primary" onClick={() => apply('replace')}>이 {parsed.items.length}개로 시나리오 바꾸기</button>
              {draft.scenario.length > 0 && <button onClick={() => apply('append')}>지금 시나리오 뒤에 추가</button>}
            </div>
          </>
        ) : (
          <div className="alert alert-warn">시각(예: 08:30, 9시 10분)이 있는 줄을 찾지 못했습니다. 시간표 부분을 복사했는지 확인하세요.</div>
        )
      )}
    </div>
  );
}

// ---------------- ② AI 도우미 ----------------

function AiCard({ draft, setDraft, onDone }: { draft: TournamentConfig; setDraft: (c: TournamentConfig) => void; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [answer, setAnswer] = useState('');
  const { result, parseErr } = useMemo((): { result: AiResult | null; parseErr: string | null } => {
    if (!answer.trim()) return { result: null, parseErr: null };
    try {
      return { result: parseAiConfig(extractJson(answer), draft), parseErr: null };
    } catch (e: any) {
      return { result: null, parseErr: e?.message?.includes('JSON') ? e.message : 'AI 답을 읽지 못했습니다. 답 전체를 복사했는지 확인하세요.' };
    }
  }, [answer, draft.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildAiPrompt());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      prompt('아래 요청문을 복사하세요', buildAiPrompt());
    }
  };

  const apply = () => {
    if (!result) return;
    if (!confirm('지금 대회 설정(학급·종목·배점·시나리오·경기 외 점수 항목)을 AI가 만든 내용으로 바꿀까요?\n저장하기 전까지는 [되돌리기]로 취소할 수 있습니다.')) return;
    setDraft({ ...result.config, scoring: { ...result.config.scoring, tieBreakers: draft.scoring.tieBreakers.filter((k) => !k.startsWith('event:') && !k.startsWith('bonus:')) } });
    setAnswer('');
    onDone();
  };

  const c = result?.config;
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>② AI로 계획서 전체 바꾸기 <span className="badge">학급·종목·배점·시나리오</span></h2>
      <p className="small" style={{ margin: 0 }}>평소 쓰는 AI 채팅(ChatGPT, Gemini, Claude 등 무엇이든)으로 계획서를 앱 설정으로 바꿉니다.</p>
      <ol className="small stack" style={{ margin: 0, paddingLeft: 20 }}>
        <li>
          <button className="btn-primary btn-sm" onClick={copyPrompt}>{copied ? '✅ 요청문 복사됨' : '요청문 복사'}</button>
        </li>
        <li>
          AI 채팅을 열고 <b>계획서 파일을 첨부</b>한 뒤, 복사한 요청문을 붙여넣어 보냅니다.
          <div className="muted">한글(HWP) 파일을 못 읽는 AI는 PDF로 저장하거나 화면 캡처 사진을 첨부하세요. 학생 이름 등 개인정보가 있는 쪽은 빼고 올리세요.</div>
          <div className="row" style={{ marginTop: 4 }}>
            <a className="btn btn-sm" href="https://chatgpt.com/" target="_blank" rel="noreferrer">ChatGPT ↗</a>
            <a className="btn btn-sm" href="https://gemini.google.com/" target="_blank" rel="noreferrer">Gemini ↗</a>
            <a className="btn btn-sm" href="https://claude.ai/" target="_blank" rel="noreferrer">Claude ↗</a>
          </div>
        </li>
        <li>AI가 답한 내용을 <b>전부</b> 복사해 아래 칸에 붙여넣습니다.</li>
      </ol>
      <textarea style={{ minHeight: 120, fontFamily: 'monospace', fontSize: 13 }} value={answer} onChange={(e) => setAnswer(e.target.value)}
        placeholder={'AI의 답을 여기에 붙여넣기\n```json\n{ "title": ..., "events": [...], "scenario": [...] }\n```'} aria-label="AI 답 붙여넣기" />
      {parseErr && <div className="alert alert-danger">{parseErr}</div>}
      {c && result && (
        <>
          <div className="item stack small">
            <div><b>{c.title}</b> · {c.school || '학교 이름 없음'} · {c.date}</div>
            <div>학급: {c.grades.map((g) => `${g.grade}학년 ${g.classCount}학급`).join(', ') || '없음'}</div>
            <div>
              종목 {c.events.length}개:
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {c.events.map((e) => (
                  <li key={e.id}>
                    <b>{e.name}</b> · {FORMAT_LABELS[e.format.type]} · {matchRuleLabel(e)} · {e.scope === 'school' ? '전교' : `${e.grades.join('·')}학년 학년별`}
                    {' · '}🔒 배점 {e.points.byRank.length ? e.points.byRank.join('/') : '없음'}{e.points.participation ? ` + 참가 ${e.points.participation}` : ''}{e.points.weight !== 1 ? ` ×${e.points.weight}` : ''}
                  </li>
                ))}
              </ul>
            </div>
            <div>시나리오 {c.scenario.length}개{c.scenario.length ? ` (${c.scenario[0].time} ${c.scenario[0].title} … ${c.scenario[c.scenario.length - 1].time} ${c.scenario[c.scenario.length - 1].title})` : ''}</div>
            <div>경기 외 점수: {c.scoring.bonusCategories.map((b) => b.name + (b.negative ? '(감점)' : '')).join(', ') || '없음'}</div>
          </div>
          {result.fixes.length > 0 && (
            <div className="alert alert-warn">
              앱이 고치거나 채운 부분:
              <ul>{result.fixes.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          )}
          {result.errors.length > 0 && (
            <div className="alert alert-danger">
              적용한 뒤 고쳐야 할 부분:
              <ul>{result.errors.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          )}
          <p className="muted small" style={{ margin: 0 }}>AI는 틀릴 수 있습니다. 적용한 뒤 [기본·학급]·[종목]·[시나리오] 탭에서 꼭 확인하세요. 대회 ID는 지금 것({draft.id})을 그대로 씁니다.</p>
          <button className="btn-primary" onClick={apply}>이 내용으로 대회 설정 바꾸기</button>
        </>
      )}
    </div>
  );
}
