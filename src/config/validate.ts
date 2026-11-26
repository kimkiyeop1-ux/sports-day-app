import type { TournamentConfig } from './types';
import { parseHM } from '../lib/time';
import { TIE_KEY_RE } from '../lib/scoring';

const ID_RE = /^[a-z0-9][a-z0-9-_]*$/i;
const FORMATS = ['single_elim', 'round_robin', 'groups_knockout', 'ranking'];

/**
 * 설정 파일 검사. 문제가 있으면 한국어 오류 메시지 목록을 돌려준다(없으면 빈 배열).
 * 계획서 → config 변환 후 `npm run check-config` 로도 실행된다.
 */
export function validateConfig(raw: unknown): string[] {
  const e: string[] = [];
  const c = raw as Partial<TournamentConfig>;
  if (!c || typeof c !== 'object') return ['설정이 비어 있거나 JSON 형식이 아닙니다.'];
  if (c.version !== 1) e.push('version 은 1 이어야 합니다.');
  if (!c.id || !ID_RE.test(c.id)) e.push('대회 ID(id)는 영문·숫자·하이픈만 쓸 수 있습니다. 예: 2026-sample');
  if (!c.title) e.push('대회 이름(title)이 비어 있습니다.');
  if (!c.date || !/^\d{4}-\d{2}-\d{2}$/.test(c.date)) e.push('대회 날짜(date)는 YYYY-MM-DD 형식이어야 합니다.');

  const grades = Array.isArray(c.grades) ? c.grades : [];
  if (grades.length === 0) e.push('학년·학급(grades)이 최소 1개 있어야 합니다.');
  const gradeSet = new Set<number>();
  for (const g of grades) {
    if (!Number.isInteger(g.grade) || g.grade < 1) e.push(`학년 값이 잘못되었습니다: ${g.grade}`);
    if (!Number.isInteger(g.classCount) || g.classCount < 1 || g.classCount > 30)
      e.push(`${g.grade}학년 학급 수는 1~30 사이여야 합니다.`);
    if (gradeSet.has(g.grade)) e.push(`${g.grade}학년이 두 번 들어 있습니다.`);
    gradeSet.add(g.grade);
  }

  const events = Array.isArray(c.events) ? c.events : [];
  const evIds = new Set<string>();
  for (const ev of events) {
    const n = ev.name || ev.id || '(이름 없음)';
    if (!ev.id || !ID_RE.test(ev.id)) e.push(`종목 "${n}"의 ID는 영문·숫자·하이픈만 쓸 수 있습니다.`);
    if (evIds.has(ev.id)) e.push(`종목 ID "${ev.id}"가 중복됩니다.`);
    evIds.add(ev.id);
    if (!ev.name) e.push(`종목 ID "${ev.id}"의 이름이 비어 있습니다.`);
    if (!ev.format || !FORMATS.includes(ev.format.type)) e.push(`종목 "${n}"의 경기 방식이 잘못되었습니다.`);
    if (!Array.isArray(ev.grades) || ev.grades.length === 0) e.push(`종목 "${n}"에 참가 학년이 없습니다.`);
    else for (const g of ev.grades) if (!gradeSet.has(g)) e.push(`종목 "${n}"의 참가 학년 ${g}학년이 학년 목록에 없습니다.`);
    if (ev.format?.type === 'groups_knockout') {
      if (!ev.format.groupCount || ev.format.groupCount < 2) e.push(`종목 "${n}": 조 개수는 2 이상이어야 합니다.`);
      if (!ev.format.advancePerGroup || ev.format.advancePerGroup < 1) e.push(`종목 "${n}": 조별 진출 수는 1 이상이어야 합니다.`);
    }
    if (ev.format?.rankBy && !['rank', 'record_low', 'record_high'].includes(ev.format.rankBy))
      e.push(`종목 "${n}": 순위 방법(rankBy)은 rank, record_low, record_high 중 하나여야 합니다.`);
    if (ev.match?.mode === 'sets' && !(ev.match.setsToWin && ev.match.setsToWin >= 1))
      e.push(`종목 "${n}": 세트제는 선승 세트 수가 필요합니다.`);
    const p = ev.points;
    if (!p || !Array.isArray(p.byRank)) e.push(`종목 "${n}"의 배점(points.byRank)이 없습니다.`);
    else if (!(p.weight > 0)) e.push(`종목 "${n}"의 가중치는 0보다 커야 합니다.`);
  }

  const scenario = Array.isArray(c.scenario) ? c.scenario : [];
  const scIds = new Set<string>();
  for (const s of scenario) {
    if (!s.id) e.push(`시나리오 "${s.title}"에 id가 없습니다.`);
    if (scIds.has(s.id)) e.push(`시나리오 id "${s.id}"가 중복됩니다.`);
    scIds.add(s.id);
    if (!s.title) e.push(`시나리오 ${s.id}의 제목이 비어 있습니다.`);
    if (parseHM(s.time) === null) e.push(`시나리오 "${s.title}"의 시각 "${s.time}"이 HH:MM 형식이 아닙니다.`);
    if (s.eventId && !evIds.has(s.eventId)) e.push(`시나리오 "${s.title}"의 종목 "${s.eventId}"가 종목 목록에 없습니다.`);
  }
  if (c.rehearsalOf != null && (typeof c.rehearsalOf !== 'string' || !ID_RE.test(c.rehearsalOf))) e.push('rehearsalOf 값이 잘못되었습니다.');
  if (!c.scoring || !Array.isArray(c.scoring.bonusCategories)) e.push('scoring.bonusCategories 가 없습니다.');
  else {
    const bonusIds = new Set(c.scoring.bonusCategories.map((b) => b.id));
    for (const k of Array.isArray(c.scoring.tieBreakers) ? c.scoring.tieBreakers : []) {
      if (!TIE_KEY_RE.test(k)) e.push(`동점 규칙 "${k}"을(를) 알 수 없습니다.`);
      else if (k.startsWith('event:') && !evIds.has(k.slice(6))) e.push(`동점 규칙의 종목 "${k.slice(6)}"이(가) 종목 목록에 없습니다.`);
      else if (k.startsWith('bonus:') && !bonusIds.has(k.slice(6))) e.push(`동점 규칙의 경기 외 점수 "${k.slice(6)}"이(가) 항목 목록에 없습니다.`);
    }
    if (c.scoring.sharedRankPoints && !['same', 'average'].includes(c.scoring.sharedRankPoints))
      e.push('공동 순위 점수 방식(sharedRankPoints)은 same 또는 average 여야 합니다.');
  }
  return e;
}
