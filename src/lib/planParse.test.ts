import { describe, expect, it } from 'vitest';
import { extractJson, parseAiConfig, parseScenarioText } from './planParse';

const events = [
  { id: 'dodgeball', name: '피구' },
  { id: 'relay', name: '계주' },
];

describe('시간표 붙여넣기 → 시나리오', () => {
  it('한글 표를 복사한 탭 구분 글', () => {
    const text = ['시간\t내용\t담당', '08:30~08:50\t학생 입장 및 정렬\t학년부', '08:50~09:10\t개회식\t교무부', '09:10~10:10\t피구 예선\t체육부'].join('\n');
    const { items } = parseScenarioText(text, events);
    expect(items.map((i) => [i.time, i.durationMin, i.title, i.owner, i.eventId])).toEqual([
      ['08:30', 20, '학생 입장 및 정렬', '학년부', undefined],
      ['08:50', 20, '개회식', '교무부', undefined],
      ['09:10', 60, '피구 예선', '체육부', 'dodgeball'],
    ]);
  });
  it('여러 가지 시각 표기와 소요 시간', () => {
    const text = '8시 30분 입장\n9.10 준비운동 (10분)\n오후 1:10 - 1:50 | 계주 결승 | 체육부\n13시 폐회식';
    const { items } = parseScenarioText(text, events);
    expect(items.map((i) => [i.time, i.durationMin, i.title])).toEqual([
      ['08:30', 40, '입장'],
      ['09:10', 10, '준비운동'],
      ['13:10', 40, '계주 결승'],
      ['13:00', 10, '폐회식'],
    ]);
    expect(items[2].owner).toBe('체육부');
    expect(items[2].eventId).toBe('relay');
  });
  it('공백으로만 나뉜 한 줄에서 마지막 단어가 담당자면 분리, 시각 없는 줄은 앞 순서의 멘트', () => {
    const { items } = parseScenarioText('08:50 개회식 교무부\n지금부터 개회식을 시작하겠습니다.\n1:10 점심 이후 응원전 학생회', []);
    expect(items[0]).toMatchObject({ time: '08:50', title: '개회식', owner: '교무부', note: '지금부터 개회식을 시작하겠습니다.' });
    expect(items[1]).toMatchObject({ time: '13:10', title: '점심 이후 응원전', owner: '학생회' });
  });
});

describe('AI 답 → 대회 설정', () => {
  const answer = `네, 계획서를 정리했습니다.
\`\`\`json
{
  "title": "2027 우리중 체육대회", "school": "우리중학교", "date": "2027년 5월 14일",
  "grades": [{"grade": 1, "classCount": 6}, {"grade": "2", "classCount": 6}],
  "events": [
    {"name": "피구", "scope": "grade", "grades": [1,2], "format": {"type": "single_elim", "thirdPlaceMatch": true},
     "match": {"mode": "sets", "setsToWin": 2}, "points": {"byRank": [100, 80, 60], "participation": 10, "weight": 1}, "location": "운동장"},
    {"name": "줄다리기", "format": {"type": "토너먼트"}, "points": {}},
    {"name": "계주", "scope": "school", "format": {"type": "ranking", "rankBy": "record_low", "heatSize": 4}, "points": {"byRank": [50,40]},}
  ],
  "scenario": [
    {"time": "8:30", "durationMin": 20, "title": "개회식", "owner": "교무부"},
    {"time": "09:00", "durationMin": "60", "title": "피구 예선", "event": "피구"},
    {"time": "", "title": "시각 없음"}
  ],
  "bonusCategories": [{"name": "응원점수"}, {"name": "감점", "negative": true}]
}
\`\`\`
확인해 주세요.`;

  it('설명 글·코드 블록·끝 쉼표가 있어도 JSON을 꺼낸다', () => {
    const j = extractJson(answer) as any;
    expect(j.events).toHaveLength(3);
  });

  it('빠진 값은 채우고 틀린 값은 고친 뒤 무엇을 고쳤는지 알려 준다', () => {
    const { config, fixes, errors } = parseAiConfig(extractJson(answer), { id: '2027-urijung' });
    expect(config.id).toBe('2027-urijung');
    expect(config.date).toBe('2027-05-14');
    expect(config.grades).toEqual([{ grade: 1, classCount: 6 }, { grade: 2, classCount: 6 }]);
    expect(config.events.map((e) => e.id)).toEqual(['event1', 'event2', 'event3']);
    expect(config.events[1].format.type).toBe('single_elim');
    expect(config.events[1].grades).toEqual([1, 2]);
    expect(config.events[2]).toMatchObject({ scope: 'school', format: { type: 'ranking', rankBy: 'record_low', heatSize: 4 } });
    expect(config.scenario.map((s) => [s.time, s.durationMin, s.eventId])).toEqual([
      ['08:30', 20, undefined],
      ['09:00', 60, 'event1'],
    ]);
    expect(config.scoring.bonusCategories).toEqual([{ id: 'b1', name: '응원점수' }, { id: 'b2', name: '감점', negative: true }]);
    expect(fixes.join(' ')).toContain('줄다리기');
    expect(fixes.join(' ')).toContain('시각이나 이름');
    expect(errors).toEqual([]);
  });

  it('JSON이 없으면 알기 쉬운 오류', () => {
    expect(() => extractJson('죄송합니다. 파일을 읽을 수 없습니다.')).toThrow('JSON을 찾지 못했습니다');
  });
});
