// =============================================================
// 대회 설정 파일(config JSON)의 형식
// 매년/학교가 바뀌면 configs/ 폴더의 JSON 파일만 새로 만들면 됩니다.
// =============================================================

/** 학급 ID 형식: "학년-반" (예: "2-3") */
export type ClassId = string;

export interface GradeConfig {
  /** 학년 (예: 2) */
  grade: number;
  /** 학급 수 (예: 8 → 2-1 ~ 2-8) */
  classCount: number;
}

/** 대진 방식 */
export type FormatType =
  | 'single_elim' //   싱글 토너먼트
  | 'round_robin' //   리그(풀리그)
  | 'groups_knockout' // 조별리그 + 토너먼트
  | 'ranking'; //      순위제(계주, 단체줄넘기 등 한 번에 순위를 매기는 종목)

export interface FormatConfig {
  type: FormatType;
  /** 조별리그: 조 개수 */
  groupCount?: number;
  /** 조별리그: 조마다 본선 진출 학급 수 */
  advancePerGroup?: number;
  /** 토너먼트: 3·4위전 여부 */
  thirdPlaceMatch?: boolean;
  /** 순위제: 한 번에 같이 뛰는 학급 수(0 또는 생략 = 전체가 한 번에) */
  heatSize?: number;
  /**
   * 순위제: 최종 순위를 정하는 방법
   * 'rank'        = 순위를 직접 입력(기본)
   * 'record_low'  = 기록이 낮을수록 높은 순위(달리기 시간 등)
   * 'record_high' = 기록이 높을수록 높은 순위(줄넘기 횟수 등)
   */
  rankBy?: 'rank' | 'record_low' | 'record_high';
}

/** 한 경기의 승패 결정 방식 */
export interface MatchRule {
  /** score: 점수(골) 비교 / sets: 세트제(예: 3판 2선승) */
  mode: 'score' | 'sets';
  /** 세트제: 이겨야 하는 세트 수(3판2선승이면 2) */
  setsToWin?: number;
  /** 리그 경기에서 무승부 허용 */
  allowDraw?: boolean;
}

/** 종목 배점 */
export interface PointsConfig {
  /** 최종 순위별 점수. [1위, 2위, 3위, ...] */
  byRank: number[];
  /** 참가점(모든 참가 학급에 부여) */
  participation: number;
  /** 리그 경기 승점(승/무/패) – 리그 순위 계산용 */
  leagueWin: number;
  leagueDraw: number;
  leagueLoss: number;
  /** 종목 가중치(최종 점수 = (순위점수 + 참가점) × 가중치) */
  weight: number;
}

export interface EventConfig {
  /** 영문/숫자 ID (예: "dodgeball") – 링크 주소에 쓰입니다 */
  id: string;
  /** 종목명 (예: "피구") */
  name: string;
  /** 대진 단위: grade = 학년별로 따로 / school = 전교 학급이 함께 */
  scope: 'grade' | 'school';
  /** 참가 학년 */
  grades: number[];
  format: FormatConfig;
  match: MatchRule;
  points: PointsConfig;
  /** 장소 (예: "운동장 A") */
  location?: string;
  /** 메모 */
  memo?: string;
}

/** 진행 시나리오 한 줄 */
export interface ScenarioItem {
  id: string;
  /** 계획 시각 "HH:MM" */
  time: string;
  /** 예상 소요 시간(분) */
  durationMin: number;
  /** 순서 이름 (예: "개회식") */
  title: string;
  /** 담당자 */
  owner?: string;
  /** 방송 멘트 메모 (관리자만 볼 수 있음) */
  note?: string;
  /** 관련 종목 ID */
  eventId?: string;
}

/** 경기 외 점수 항목(응원점수, 질서점수, 감점 등) */
export interface BonusCategory {
  id: string;
  name: string;
  /** true면 감점 항목 */
  negative?: boolean;
}

export interface ScoringConfig {
  bonusCategories: BonusCategory[];
  /**
   * 총점 동점 처리 규칙(위에서부터 순서대로 적용). 관리자 [점수·순위 → 동점 규칙]에서 바꿀 수 있음.
   * 'mostFirstPlaces' / 'mostSecondPlaces' / 'mostThirdPlaces' = 종목 1·2·3위 횟수 많은 학급 우선
   * 'eventTotal'      = 경기 점수(경기 외 점수 제외) 합이 높은 학급 우선
   * 'event:<종목ID>'  = 해당 종목 순위가 높은 학급 우선
   * 'bonus:<항목ID>'  = 해당 경기 외 점수가 높은(감점 항목은 적은) 학급 우선
   * 마지막까지 같으면 공동 순위
   */
  tieBreakers: string[];
  /**
   * 종목에서 공동 순위일 때 순위 점수(기본 same)
   * 'same'    = 그 순위 점수를 모두 받음(공동 3위 2학급 → 둘 다 3위 점수)
   * 'average' = 차지한 자리들의 평균(공동 3위 2학급 → (3위+4위)/2)
   */
  sharedRankPoints?: 'same' | 'average';
}

export interface TournamentConfig {
  /** 설정 파일 형식 버전 */
  version: 1;
  /** 대회 ID (영문/숫자/하이픈, 예: "2026-sample") */
  id: string;
  title: string;
  school: string;
  /** 대회 날짜 "YYYY-MM-DD" */
  date: string;
  grades: GradeConfig[];
  events: EventConfig[];
  scenario: ScenarioItem[];
  scoring: ScoringConfig;
  /** 리허설용 대회면 원래 대회 ID(앱이 자동으로 넣음) */
  rehearsalOf?: string;
}
