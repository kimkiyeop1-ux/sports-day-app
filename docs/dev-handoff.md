# 개발 인수인계 메모 (Claude Code 세션 간 이어받기용)

새 세션에서 이어서 개발할 때 이 파일과 README를 먼저 읽으세요.

## 사용자
- 중학교 체육 교사(코딩 초보). 설명은 한국어로 쉽게, 직접 해야 하는 일은 클릭 순서대로 안내.
- 각 단계가 끝나면 "무엇을 눌러서 확인하면 되는지" 알려줄 것.

## 확정된 결정 사항
1. 학년 범위: 미정 → 여러 학년 지원 구조, 샘플은 2학년 8학급·종목 4개(`configs/sample-2026.json`)
2. 비공개 대상: **학급 총점·순위**. 경기 결과(승패·스코어)는 공개 가능. 배점표는 비공개 권장.
3. 비용: Firebase 무료(Spark). Cloud Functions 없음 → 총점·순위 계산은 관리자 브라우저에서만.
4. 관리자: 1명(Google 로그인). 최초 1명은 앱에서 자기등록, 이후 변경은 Firebase 콘솔.
5. 심판: 종목별 6자리 PIN 1개 + 최초 입력 시 교사 이름 입력(이력에 기록). 링크에 무작위 토큰.
6. 동점 처리: 추후 설정(기본 `mostFirstPlaces`, 설정에서 순서 변경 가능하게).
7. 학생은 큰 스크린(전광판)으로만 봄 → 학생 개인 폰 화면은 간단히.
8. 최종 공개는 **진행 교사**가 함 → 5단계에서 '공개 진행자용 링크 + PIN' 별도 제공, 학년별/전교 선택 가능.
9. 저장소: `kimkiyeop1-ux/sports-day-app` (Public), GitHub Pages(Actions) 배포.
10. 효과음: 자체 합성(WebAudio) 기본 + 음원 파일로 교체 가능.
11. **여러 학교 공유**: 사이트 하나를 공유, 학교마다 자기 Firebase를 앱의 [학교 연결]에서 연결.
    안정판(`/`, `STABLE_VERSION` 커밋) / 개발판(`/dev/`, main 최신) 분리. 규칙 버전 확인 기능 있음.

## 진행 상황
- ✅ 0단계: 프로젝트, 샘플 config, 설정 검사기, 학교 연결 화면, 배포 워크플로
- ✅ 1단계: 대회 설정 편집, 시나리오 진행(완료 시각·지연), 전광판 진행 화면
- ✅ 2단계: 대진표 엔진 + 관리자 대진표 화면 + 공개 대진표(`#/bracket`)
  - 엔진: `src/lib/bracket.ts` (화면과 무관한 순수 함수, 테스트 `src/lib/bracket.test.ts`)
    - 대진 단위(Division): 학년별 종목은 학년마다(`g2`), 전교 종목은 하나(`all`). 경기 ID = `{단위}-R{라운드}-{번호}` / `{단위}-G{조}-{번호}` / `{단위}-3rd`
    - 자리(Slot): 학급 / 부전승 / 경기 승자 / 경기 패자 / 조 순위 → `resolveDivision`이 결과를 반영해 실제 대진·승자를 계산
    - 결과(MatchResult): 점수제 득점 또는 세트제 이긴 세트 수(+세트별 점수), 기권(forfeit), 동점 승부결정(tbWinner), 재경기 횟수(replays). 점수 없는 결과 = 경기 전
    - 리그 순위: 승점 → 동률끼리 상대전적 → 득실차 → 다득점 → 그래도 같으면 '동률' 표시 후 관리자가 순서 직접 지정(groupOrder)
    - `finalRanking`: 종목 최종 순위(공동 순위 포함, 미정=null). **4단계 점수 계산에서 이것을 사용**. 공개 화면에는 표시하지 않음
  - 저장: `private/bracket_{종목}`(원본, 메모 포함) + `public/bracket_{종목}`(메모 제거, 배점 없음). Firestore가 '배열 안의 배열'을 못 넣어서 `{ json: 문자열 }` 형식
  - 순위제 종목은 config `format.rankBy`(rank / record_low / record_high) 추가
  - 보안 규칙은 바뀌지 않음(RULES_VERSION 1 그대로). 대진표 관련 규칙 테스트만 추가
  - 3단계 참고: 지금은 관리자만 결과를 입력. 심판 입력을 붙일 때는 결과를 종목별 별도 문서(예: `results_{종목}`)로 분리하고 규칙에서 PIN 세션을 확인하는 방식 권장(심판이 대진 구조를 바꾸지 못하게)
- ✅ 3단계: 심판 링크+PIN, 실시간, 오프라인, 이력·되돌리기 (규칙 버전 2)
  - 결과 저장 위치 변경: `public/results_{종목}` 문서 하나에 `r.{경기ID}` = 결과 JSON 문자열, `rec.{대진단위}` = 순위제 기록.
    경기마다 칸이 따로라 여러 심판이 동시에 써도 덮어쓰지 않음(`setDoc` + `mergeFields`). `"{}"` = 지운 결과.
    2단계 형식(대진표 문서 안 results/records)은 관리자 대진표 화면을 열면 자동으로 옮겨짐(`readResults`가 두 형식을 합쳐 읽음)
  - 관리자 메모는 `private/notes_{종목}` (공개 안 됨)
  - 심판: `private/referee.keys[종목] = {token, pin}` → 심판이 `refSessions/{uid}`에 `{ev, token, pin, name}`을 쓰면 규칙이 대조.
    결과 쓰기·이력 쓰기 때마다 세션의 token·pin이 현재 값과 같은지 다시 확인 → PIN을 새로 만들면 예전 기기 즉시 차단
  - 심판 화면 `src/pages/referee/Referee.tsx` (익명 로그인, 공개 문서만 읽음 — 배점 코드 없음). 결과 입력 창은 `src/pages/bracket/Editors.tsx` 공용
  - 서버가 PIN을 확인하기 전(지연 반영 상태)에는 심판 화면으로 넘어가지 않게 `!sess.pending` 확인(안 하면 틀린 PIN이 잠깐 통과한 것처럼 보임)
  - 이력: 결과·기록 이력에 `kind/ev/matchId/div`를 남기고 `#/admin/history`에서 되돌리기(되돌리기도 이력에 남음)
  - 규칙 버전 확인은 `meta/{check}`에서 v1·v2 모두 허용(안정판이 v2 규칙을 '최신'으로 인식하도록)
- ✅ 4단계: 점수·순위 엔진, 경기 외 점수, 동점 규칙
  - 엔진 `src/lib/scoring.ts`(테스트 `scoring.test.ts`): 종목 점수 = (byRank[순위-1] + 참가점) × 가중치, 순위 미정 = 0점.
    공동 순위 점수 `scoring.sharedRankPoints`(same/average, 학년별 종목은 학년마다 인원 계산).
    총점 = 종목 점수 합 + 경기 외 점수(negative 항목은 뺌). 종합 순위 = 총점 → tieBreakers 순서 → 공동 순위(1,2,2,4)
  - 동점 규칙 키: mostFirstPlaces / mostSecondPlaces / mostThirdPlaces / eventTotal / event:<종목> / bonus:<항목> (`validate.ts`에서 검사)
  - 화면 `src/pages/admin/Scores.tsx`(`#/admin/scores`): 모든 종목의 대진표·결과 문서를 `useDocs`로 구독해 관리자 브라우저에서 계산. **총점·순위는 Firestore에 저장하지 않음**(5단계 공개 연출 때 필요한 것만 별도 설계)
  - 경기 외 점수 `private/bonus` 문서 `v.{항목}.{학급}`, 변경 이력·되돌리기 지원(kind 'bonus')
  - 보안 규칙 변경 없음(v2 그대로)
- ✅ 5단계: 블라인드, 최종 순위 발표 연출 (규칙 버전 3)
  - 블라인드: `public/blind.events.{종목}=true`. 이때 결과·기록은 `hidden/results_{종목}`(관리자·그 종목 심판만 읽기/쓰기)에 저장.
    규칙 `blindOn()`이 `getAfter`로 확인해 공개본(`public/results_*`) 쓰기를 관리자 포함 거부.
    [결과 공개] = `blindOff()`: 블라인드 false + hidden → 공개본 복사 + hidden 삭제를 **한 묶음**으로(getAfter 덕분에 허용)
  - 블라인드 중에는 대진표 다시 만들기·자리 수정 불가(공개본 통째 쓰기가 필요해서) — 관리자 화면에서 안내
  - 읽는 쪽: 관리자·심판·점수 화면은 `readResults(공개본, 예전형식, hidden)`으로 합쳐 읽음. 공개 화면은 공개본만
  - 공개 진행자: 심판과 같은 방식, 키 이름 `_presenter`(종목 ID는 '_'로 시작 못 하므로 겹치지 않음. Firestore는 `__x__` 필드명 금지).
    `reveal/{all|g2}` 문서는 관리자·진행자만 읽기. 관리자가 [발표 자료 만들기]로 그 순간의 종합 순위를 저장(점수 공개 여부, N위부터 발표 선택)
  - 발표 화면 `src/pages/reveal/RevealStage.tsx`(관리자 미리보기와 진행자 화면 공용), 효과음 `src/lib/sound.ts`(WebAudio 합성, `public/sounds/*.mp3` 있으면 우선)
  - 규칙 확인 번호 목록에 v3 추가(v1·v2 앱도 호환)
- ✅ 6단계: PWA(오프라인 앱 셸), CSV 내보내기, 리허설 모드·전체 초기화
  - PWA: `public/manifest.webmanifest`·아이콘, 서비스 워커는 `vite.config.ts`의 플러그인이 빌드 결과 목록으로 `scripts/sw-template.js` → `dist/sw.js` 생성.
    페이지는 네트워크 우선(끊기면 저장본), 해시 붙은 파일은 저장본 우선. 새 버전은 `UpdateBanner`의 [새로고침]을 누를 때만 교체(`src/lib/pwa.ts`).
    배포판에서만 등록(개발·에뮬레이터 제외). `/`와 `/dev/`는 각자 자기 서비스 워커를 가짐
  - 백업 `src/pages/admin/Backup.tsx`: CSV(엑셀용 BOM, 수식 주입 방지 `src/lib/csv.ts`), 전체 백업 JSON(`collectBackup`). 파일 이름은 영문(한글 이름은 'download'로 바뀌는 브라우저가 있음)
  - 리허설: `startRehearsal` = 설정 복사(`{id}-rehearsal`, 제목 앞 [리허설], `rehearsalOf`) + 심판·진행자 키 복사 + 현재 대회 전환. `endRehearsal` = `meta/active`를 원래 ID로. 진짜 대회 기록은 건드리지 않음
  - 전체 초기화 `resetTournament`: 설정·심판 키만 남기고 모두 삭제(블라인드 문서와 결과 공개본은 같은 묶음에서 삭제해야 규칙 통과). UI는 대회 ID를 직접 입력해야 실행되고 실행 전 JSON 백업 자동 다운로드
  - 보안 규칙 변경 없음(v3)

- ✅ 학교 연결 간소화: `src/pages/Connect.tsx` + `src/lib/setupCheck.ts`
  - 연결 전: ① 프로젝트 이름(콘솔 주소 붙여넣기도 인식) ② [연결 정보 화면 열기](콘솔 settings/general로 직행) → firebaseConfig 붙여넣기
  - 연결 후 자동 점검: Firestore(규칙 확인 문서 읽기 → not-found 등=DB 없음, permission-denied=규칙 옛것), 익명 로그인(임시 앱으로 signInAnonymously 후 계정 삭제),
    Google 로그인·허용 도메인(Identity Toolkit 공개 API `projects?key=`, `accounts:createAuthUri`). ❌마다 정확한 콘솔 URL 버튼, 창 포커스 시 자동 재확인
  - 실제 Firebase(에뮬레이터 아님)에서 '안 됨' 판정 문구는 오류 코드 기반 추정 — 학교에서 처음 써 볼 때 결과를 꼭 확인할 것(자동 확인 실패 시 ❔ + 버튼은 그대로 표시)
  - 관리자 로그인 실패 시 원인별 안내 + 학교 연결 화면 링크

- ✅ 계획서 → 설정(앱 안): `src/lib/planParse.ts`(테스트 `planParse.test.ts`), 화면 `src/pages/admin/PlanImport.tsx`(대회 설정 첫 탭)
  - `parseScenarioText`: 시간표 붙여넣기 → 시나리오(08:30·8시 30분·8.30·오후 1:10, ~/- 범위, (N분), 탭·|·2칸 공백 칸 나눔, 담당자 추정, 시각 없는 줄 = 앞 순서 메모, 종목 이름 자동 연결, 1~5시는 오후로 봄)
  - `buildAiPrompt`/`extractJson`/`parseAiConfig`: 아무 AI 채팅용 요청문 → 답(JSON) 정리(코드 블록·끝 쉼표 허용, ID·기본값 채움, 고친 내용 목록). 대회 ID는 현재 것 유지
  - 첫 실행 [📄 우리 학교 계획서로 시작] = `{연도}-sportsday` 대회를 샘플 구조로 만든 뒤 이 탭으로 이동
  - 결정: 앱 내장 AI(Firebase AI Logic/Gemini)는 보류(사용자 선택: 붙여넣기 + AI 도우미)

## 다음 할 일(제안)
- 학교 실제 계획서로 config 만들기 → 리허설 모드로 하루 운영 연습 → 문제 없으면 `npm run release`로 안정판 지정 → 다른 학교 안내
- 안정판은 현재 2단계 시점(3460cf6)으로 고정되어 있음

## 데이터 설계 원칙 (꼭 지킬 것)
- 공개 화면은 `tournaments/{t}/public/*` 와 `meta/active` 만 읽는다. 여기에 총점·순위·종목별 획득 점수를 절대 쓰지 않는다.
- 관리자 데이터는 `private/*`, 이력은 `audit/*`(추가만, 수정 불가).
- 공개 데이터는 종목당 문서 1개처럼 묶어서 읽기 횟수(무료 한도 5만/일)를 아낀다.
- 규칙을 바꾸면 `firestore.rules`의 `rulesCheck_v` 목록에 새 번호를 추가하고 `src/lib/rulesVersion.ts`의 `RULES_VERSION`을 함께 올리고, `tests/rules`에 테스트를 추가한다.
- 관리자 화면 코드는 lazy import로 분리해 전광판 번들에 배점 관련 코드가 섞이지 않게 한다.

## 개발 환경 메모
- 규칙 테스트·에뮬레이터는 Java 21 필요(`apt-get install -y openjdk-21-jre-headless`).
- 에뮬레이터 수동 시험: `npm run emulators` → `npm run seed` → `npm run dev:emu` → 관리자 화면의 '(개발용) 테스트 관리자로 로그인'.
