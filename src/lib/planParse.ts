// =============================================================
// 계획서 → 대회 설정 (앱 안에서, 서버·AI 키 없이)
//  1) parseScenarioText: 계획서의 시간표를 복사해 붙여넣으면 시나리오로 바꾼다(AI 없음)
//  2) buildAiPrompt / parseAiConfig: 선생님이 쓰는 AI 채팅에 줄 요청문을 만들고,
//     AI의 답(JSON)을 받아 빠진 값은 채우고 틀린 값은 고쳐 설정으로 만든다
// =============================================================
import type { EventConfig, FormatType, ScenarioItem, TournamentConfig } from '../config/types';
import { validateConfig } from '../config/validate';

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

// 08:30 · 8:30 · 8.30 · 8시 30분 · 8시 · 오후 1:10
const TIME_RE = /(오전|오후)?\s*(\d{1,2})\s*(?:[:：.]\s*(\d{2})|시\s*(?:(\d{1,2})\s*분)?)/g;

interface TimeHit {
  min: number;
  start: number;
  end: number;
}

function findTimes(line: string): TimeHit[] {
  const out: TimeHit[] = [];
  for (const m of line.matchAll(TIME_RE)) {
    let h = Number(m[2]);
    const mm = Number(m[3] ?? m[4] ?? 0);
    if (h > 23 || mm > 59) continue;
    if (m[1] === '오후' && h < 12) h += 12;
    // '1:10'처럼 오전 6시 이전 숫자는 체육대회 특성상 오후로 본다
    else if (!m[1] && h >= 1 && h <= 5) h += 12;
    out.push({ min: h * 60 + mm, start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

const OWNER_HINT = /(부|팀|담임|학생회|교사|선생님|위원|본부|담당|교감|교장|진행)$/;

export interface ParsedScenario {
  items: ScenarioItem[];
  warnings: string[];
}

/**
 * 시간표 글 → 시나리오.
 * 한 줄 = 한 순서. 시각이 있는 줄만 순서로 보고, 시각이 없는 줄은 바로 앞 순서의 메모(방송 멘트)로 붙인다.
 * 예) "08:30~08:50  개회식  교무부", "9:10 준비운동 (10분)", "오후 1:10 - 1:50 | 결승전 | 체육부"
 */
export function parseScenarioText(text: string, events: Pick<EventConfig, 'id' | 'name'>[] = []): ParsedScenario {
  const items: (ScenarioItem & { _end?: number })[] = [];
  const warnings: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/ /g, ' ').trim();
    if (!line) continue;
    const times = findTimes(line);
    if (!times.length) {
      const prev = items[items.length - 1];
      if (prev) prev.note = prev.note ? `${prev.note}\n${line}` : line;
      continue;
    }
    const start = times[0].min;
    // 두 번째 시각이 범위 표시(~, -, –)로 이어지면 끝 시각
    let end: number | undefined;
    let cut = times[0].end;
    if (times[1] && /^\s*[~\-–—〜]\s*$/.test(line.slice(times[0].end, times[1].start))) {
      end = times[1].min;
      cut = times[1].end;
    }
    let rest = (line.slice(0, times[0].start) + ' ' + line.slice(cut)).trim();
    let duration: number | undefined;
    const dm = rest.match(/\(?\s*(\d{1,3})\s*분\s*\)?/);
    if (dm) {
      duration = Number(dm[1]);
      rest = rest.replace(dm[0], ' ');
    }
    if (end != null && end > start) duration = end - start;
    // 칸 나누기: 탭, |, 2칸 이상 공백, 쉼표
    const cells = rest
      .split(/\t+|\s*\|\s*|\s{2,}|\s*,\s*/)
      .map((c) => c.replace(/^[\s\-–~·•:]+|[\s\-–~·•:]+$/g, '').trim())
      .filter(Boolean);
    if (!cells.length) {
      warnings.push(`'${line}' 줄에 순서 이름이 없어 건너뜁니다.`);
      continue;
    }
    let title = cells[0];
    let owner: string | undefined;
    const ownerIdx = cells.findIndex((c, i) => i > 0 && c.length <= 12 && OWNER_HINT.test(c));
    if (ownerIdx > 0) owner = cells[ownerIdx];
    else if (cells.length === 1) {
      // "개회식 교무부"처럼 한 칸에 붙어 있는 경우 마지막 단어가 담당자면 분리
      const words = title.split(/\s+/);
      if (words.length > 1 && OWNER_HINT.test(words[words.length - 1])) {
        owner = words.pop();
        title = words.join(' ');
      }
    }
    const extra = cells.filter((_, i) => i !== 0 && i !== ownerIdx);
    const ev = events.find((e) => title.includes(e.name));
    items.push({
      id: `s${pad(items.length + 1)}`,
      time: hm(start),
      durationMin: duration ?? 0,
      title,
      ...(owner ? { owner } : {}),
      ...(extra.length ? { note: extra.join(' / ') } : {}),
      ...(ev ? { eventId: ev.id } : {}),
      _end: end,
    });
  }
  // 소요 시간이 없으면 다음 순서 시작까지로
  items.forEach((it, i) => {
    if (!it.durationMin) {
      const next = items[i + 1];
      const s = toMin(it.time);
      it.durationMin = next && toMin(next.time) > s ? toMin(next.time) - s : 10;
    }
    delete it._end;
  });
  return { items, warnings };
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// ---------------- AI 도우미 ----------------

/** 선생님이 AI 채팅(ChatGPT·Gemini·Claude 등)에 계획서와 함께 붙여넣을 요청문 */
export function buildAiPrompt(): string {
  return `첨부한 체육대회 계획서를 읽고, 아래 형식의 JSON 하나로만 답해 주세요. 설명 글 없이 \`\`\`json 코드 블록 하나만 출력하세요.
계획서에 없는 값은 지어내지 말고 기본값을 쓰세요. 학생 이름 등 개인정보는 넣지 마세요.

{
  "title": "대회 이름 (예: 2027 ○○중학교 체육대회)",
  "school": "학교 이름",
  "date": "YYYY-MM-DD",
  "grades": [ { "grade": 학년숫자, "classCount": 학급수 } ],
  "events": [
    {
      "name": "종목 이름 (예: 피구)",
      "scope": "grade(학년별로 따로) 또는 school(전교 학급이 함께)",
      "grades": [참가 학년 숫자들],
      "format": {
        "type": "single_elim(토너먼트) | round_robin(리그) | groups_knockout(조별리그 후 토너먼트) | ranking(계주·줄넘기처럼 기록·순위로 정함)",
        "thirdPlaceMatch": 3·4위전이 있으면 true,
        "groupCount": 조별리그면 조 개수,
        "advancePerGroup": 조별리그면 조마다 본선 진출 학급 수,
        "heatSize": 순위제에서 한 번에 함께 뛰는 학급 수(없으면 0),
        "rankBy": "순위제만: rank(순위 직접) | record_low(시간처럼 낮을수록 위) | record_high(횟수처럼 높을수록 위)"
      },
      "match": { "mode": "score(점수) 또는 sets(세트제)", "setsToWin": 세트제면 이겨야 하는 세트 수(3판2선승=2), "allowDraw": 리그 무승부 허용이면 true },
      "points": { "byRank": [1위 점수, 2위 점수, ...], "participation": 참가점, "weight": 가중치(보통 1) },
      "location": "장소"
    }
  ],
  "scenario": [
    { "time": "HH:MM", "durationMin": 분, "title": "순서 이름", "owner": "담당", "event": "관련 종목 이름(있으면)", "note": "방송 멘트(있으면)" }
  ],
  "bonusCategories": [ { "name": "응원점수 같은 경기 외 점수 항목", "negative": 감점 항목이면 true } ]
}`;
}

/** AI 답에서 JSON만 꺼내기(코드 블록·앞뒤 설명 글이 있어도 됨) */
export function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : text;
  const a = body.indexOf('{');
  const b = body.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('답에서 JSON을 찾지 못했습니다.');
  const raw = body.slice(a, b + 1);
  try {
    return JSON.parse(raw);
  } catch {
    // 흔한 실수 고치기: 끝 쉼표, 주석, 작은따옴표 키
    const fixed = raw
      .replace(/\/\/[^\n]*/g, '')
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/([{,]\s*)'([^']+)'\s*:/g, '$1"$2":');
    return JSON.parse(fixed);
  }
}

const FORMATS: FormatType[] = ['single_elim', 'round_robin', 'groups_knockout', 'ranking'];
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v.trim() : d);

function normTime(v: unknown): string | null {
  const t = findTimes(String(v ?? ''));
  return t.length ? hm(t[0].min) : null;
}

export interface AiResult {
  config: TournamentConfig;
  /** 고치거나 채운 내용(선생님에게 보여 줌) */
  fixes: string[];
  /** 그래도 남은 문제(저장 전에 고쳐야 함) */
  errors: string[];
}

/**
 * AI가 만든 JSON → 대회 설정. 대회 ID는 지금 대회 것을 그대로 쓴다(새 대회로 바꾸려면 기본 탭에서).
 * 빠진 값은 기본값으로 채우고, 형식이 틀린 값은 고친 뒤 무엇을 고쳤는지 알려 준다.
 */
export function parseAiConfig(raw: unknown, base: Pick<TournamentConfig, 'id'>): AiResult {
  const fixes: string[] = [];
  const r = (raw ?? {}) as Record<string, any>;

  const grades = (Array.isArray(r.grades) ? r.grades : [])
    .map((g: any) => ({ grade: Math.round(num(g?.grade, NaN)), classCount: Math.round(num(g?.classCount, NaN)) }))
    .filter((g: { grade: number; classCount: number }) => g.grade >= 1 && g.classCount >= 1);
  const allGrades = grades.map((g: { grade: number }) => g.grade);

  const usedIds = new Set<string>();
  const events: EventConfig[] = (Array.isArray(r.events) ? r.events : []).map((e: any, i: number) => {
    const name = str(e?.name, `종목${i + 1}`);
    let id = str(e?.id).toLowerCase();
    if (!/^[a-z0-9][a-z0-9-_]*$/.test(id) || usedIds.has(id)) id = `event${i + 1}`;
    usedIds.add(id);
    const f = e?.format ?? {};
    let type = str(f.type) as FormatType;
    if (!FORMATS.includes(type)) {
      fixes.push(`'${name}' 경기 방식을 알 수 없어 토너먼트로 정했습니다.`);
      type = 'single_elim';
    }
    const evGrades = (Array.isArray(e?.grades) ? e.grades : []).map((g: unknown) => Math.round(num(g, NaN))).filter((g: number) => allGrades.includes(g));
    const m = e?.match ?? {};
    const mode = m.mode === 'sets' ? 'sets' : 'score';
    const p = e?.points ?? {};
    const byRank = (Array.isArray(p.byRank) ? p.byRank : []).map((x: unknown) => num(x, NaN)).filter((x: number) => Number.isFinite(x));
    if (!byRank.length) fixes.push(`'${name}' 순위별 점수가 없어 비워 두었습니다. [종목] 탭에서 넣어 주세요.`);
    const rankBy = ['rank', 'record_low', 'record_high'].includes(f.rankBy) ? f.rankBy : undefined;
    const ev: EventConfig = {
      id,
      name,
      scope: e?.scope === 'school' ? 'school' : 'grade',
      grades: evGrades.length ? evGrades : allGrades,
      format: {
        type,
        ...(type === 'single_elim' || type === 'groups_knockout' ? { thirdPlaceMatch: !!f.thirdPlaceMatch } : {}),
        ...(type === 'groups_knockout' ? { groupCount: Math.max(2, Math.round(num(f.groupCount, 2))), advancePerGroup: Math.max(1, Math.round(num(f.advancePerGroup, 2))) } : {}),
        ...(type === 'ranking' ? { heatSize: Math.max(0, Math.round(num(f.heatSize, 0))), ...(rankBy ? { rankBy } : {}) } : {}),
      },
      match: mode === 'sets' ? { mode, setsToWin: Math.max(1, Math.round(num(m.setsToWin, 2))) } : { mode, ...(m.allowDraw ? { allowDraw: true } : {}) },
      points: {
        byRank,
        participation: num(p.participation, 0),
        leagueWin: num(p.leagueWin, 3),
        leagueDraw: num(p.leagueDraw, 1),
        leagueLoss: num(p.leagueLoss, 0),
        weight: num(p.weight, 1) > 0 ? num(p.weight, 1) : 1,
      },
      ...(str(e?.location) ? { location: str(e.location) } : {}),
      ...(str(e?.memo) ? { memo: str(e.memo) } : {}),
    };
    return ev;
  });

  const scenario: ScenarioItem[] = [];
  (Array.isArray(r.scenario) ? r.scenario : []).forEach((s: any, i: number) => {
    const time = normTime(s?.time);
    const title = str(s?.title);
    if (!time || !title) {
      fixes.push(`시나리오 ${i + 1}번째 줄은 시각이나 이름이 없어 뺐습니다.`);
      return;
    }
    const evName = str(s?.event ?? s?.eventName);
    const ev = events.find((e) => (evName && (e.name === evName || e.id === str(s?.eventId))) || (!evName && title.includes(e.name)));
    scenario.push({
      id: `s${pad(scenario.length + 1)}`,
      time,
      durationMin: Math.max(0, Math.round(num(s?.durationMin, 10))),
      title,
      ...(str(s?.owner) ? { owner: str(s.owner) } : {}),
      ...(str(s?.note) ? { note: str(s.note) } : {}),
      ...(ev ? { eventId: ev.id } : {}),
    });
  });

  const bonusSrc = Array.isArray(r.bonusCategories) ? r.bonusCategories : Array.isArray(r.scoring?.bonusCategories) ? r.scoring.bonusCategories : [];
  const bonusCategories = bonusSrc
    .map((b: any, i: number) => ({ id: `b${i + 1}`, name: str(b?.name), ...(b?.negative ? { negative: true } : {}) }))
    .filter((b: { name: string }) => b.name);

  let date = str(r.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const m = date.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    date = m ? `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}` : '';
    if (!date) {
      date = new Date().toISOString().slice(0, 10);
      fixes.push('대회 날짜를 찾지 못해 오늘 날짜로 넣었습니다. [기본·학급] 탭에서 고쳐 주세요.');
    }
  }

  const config: TournamentConfig = {
    version: 1,
    id: base.id,
    title: str(r.title, '체육대회') || '체육대회',
    school: str(r.school),
    date,
    grades,
    events,
    scenario,
    scoring: { bonusCategories, tieBreakers: ['mostFirstPlaces'] },
  };
  return { config, fixes, errors: validateConfig(config) };
}
