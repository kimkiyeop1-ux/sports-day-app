# 🏃 체육대회 원앱

체육대회 하루 동안 **시나리오 진행 · 대진표 · 경기 결과 입력 · 점수/순위 집계**를 한 앱에서 처리하는 웹앱입니다.
매년, 학교가 바뀌어도 **대회 설정 파일(JSON)** 만 바꾸면 다시 쓸 수 있습니다.

- 비용 0원: GitHub Pages(화면) + Firebase 무료 플랜(실시간 DB, 로그인)
- 학생 개인정보 없음: 단위는 `학년-반` 뿐
- 순위 비공개: 공개 화면은 총점·순위가 **들어 있지 않은** 공개용 문서만 읽고, 관리자 데이터는 보안 규칙으로 차단

## 개발 진행 상황

| 단계 | 내용 | 상태 |
|---|---|---|
| 0 | 저장소·샘플 설정·학교 연결 화면·안정판/개발판 배포 | ✅ |
| 1 | 대회 설정 편집, 시나리오 진행, 전광판 진행 화면 | ✅ |
| 2 | 대진표(토너먼트·리그·조별+토너먼트·순위제·세트제) | ✅ |
| 3 | 심판 입력(링크+PIN), 실시간·오프라인, 이력·되돌리기 | ✅ |
| 4 | 점수·순위 집계, 경기 외 점수, 동점 규칙 | ⏳ |
| 5 | 순위 비공개·블라인드·최종 공개 연출 | ⏳ |
| 6 | 배포 마무리(오프라인 앱), CSV 백업 | ⏳ |

## 화면(주소)

| 주소 | 누가 | 설명 |
|---|---|---|
| `#/admin` | 관리자 | 대시보드, 시나리오 진행, 대회 설정 (Google 로그인) |
| `#/admin/bracket` | 관리자 | 대진표 만들기·자리 수정(추첨 결과)·경기 결과 입력 |
| `#/admin/referee` | 관리자 | 종목별 심판 링크·PIN·QR 만들기, 접속한 심판 확인 |
| `#/admin/history` | 관리자 | 변경 이력(누가 언제 무엇을), 경기 결과·기록 되돌리기 |
| `#/ref/{종목}/{토큰}` | 심판 | 이름 + PIN 6자리 입력 후 그 종목 결과만 입력 (익명 로그인) |
| `#/board` | 전광판 | 현재 진행 중 / 다음 순서 (로그인 없음, 화면 더블클릭 = 전체화면) |
| `#/bracket` | 누구나 | 종목별 대진표·경기 결과 (로그인 없음, 총점·순위 없음) |
| `#/connect` | 각 학교 | 학교 Firebase 연결, 보안 규칙·로그인 설정 점검, 기기 공유 링크 |

---

## 다른 학교와 함께 쓰기

이 앱은 **사이트 하나를 여러 학교가 같이 쓰고, 데이터는 학교마다 각자의 Firebase에 저장**하는 구조입니다.

| | 방법 1 (추천): 공유 사이트 사용 | 방법 2: 저장소 복사(fork) |
|---|---|---|
| 필요한 것 | Google 계정 | Google 계정 + GitHub 계정 |
| 준비 | Firebase 만들기 → 앱의 [학교 연결]에 붙여넣기 | fork → Pages 설정 → `src/firebase-config.ts`에 값 입력 |
| 업데이트 | 안정판이 자동 반영 | 직접 가져와야 함 |
| 데이터 | 학교 Firebase에만 저장 | 학교 Firebase에만 저장 |

- 다른 학교용 안내서: [`docs/other-schools-guide.md`](docs/other-schools-guide.md)
- 주소
  - **안정판** `https://<아이디>.github.io/sports-day-app/` — 다른 학교에 알려 주는 주소
  - **개발판** `https://<아이디>.github.io/sports-day-app/dev/` — 새 기능 시험용
- 안정판 올리기: 개발판에서 확인이 끝나면 Claude Code에게 "안정판으로 배포해줘" (내부적으로 `npm run release` 후 push)
- 보안 규칙이 바뀌면 각 학교 관리자 화면에 '보안 규칙 업데이트 필요' 경고가 뜹니다(규칙 버전 확인 기능).
  규칙을 바꿀 때는 `firestore.rules`의 `rulesCheck_v` 목록에 새 번호를 추가하고 `src/lib/rulesVersion.ts`의 `RULES_VERSION`을 함께 올립니다.

---

## 처음 한 번만: 사이트 운영자(저장소 주인) 준비

1. https://github.com/new → Repository name `sports-day-app` → **Public** → 체크박스는 모두 끈 채 **Create repository**
2. 저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 선택
3. 코드를 올리면 자동으로 테스트 → 빌드 → 배포됩니다.

> 저장소에는 화면 코드와 샘플 설정만 들어갑니다. 실제 점수·PIN은 각 학교 Firebase에만 저장되므로 공개 저장소여도 안전합니다.
> **실제 학교 설정 파일(배점 포함)은 저장소에 올리지 말고**, 앱의 [대회 설정 → 파일]에서 불러오세요.

## 처음 한 번만: 우리 학교 연결 (모든 학교 공통)

[`docs/other-schools-guide.md`](docs/other-schools-guide.md)의 1~4단계와 같습니다. 요약:

1. Firebase 프로젝트 생성 → Firestore(서울, 프로덕션 모드) → Authentication(Google, 익명 사용 설정, 승인된 도메인에 `<아이디>.github.io` 추가) → 웹 앱 등록
2. 앱 → **🏫 학교 연결** → firebaseConfig 붙여넣기
3. 학교 연결 화면에서 **[보안 규칙 복사]** → 콘솔 규칙 화면에 붙여넣고 게시 → ✅ 확인
4. 앱 → 관리자 → Google 로그인 → **[이 계정을 관리자로 등록]** (최초 1명만 가능, 이후 추가·변경은 Firebase 콘솔에서)

---

## 🔁 새 학교 · 새 해에 다시 쓰는 법

1. **계획서 → 설정 파일 만들기**
   - Claude Code에게 체육대회 계획서(PDF)를 주고 "이 계획서로 config 만들어줘"라고 요청합니다.
   - `configs/` 폴더의 [`sample-2026.json`](configs/sample-2026.json) 형식으로 변환됩니다. 직접 만들 때도 이 파일을 복사해 고치면 됩니다.
   - 형식 설명은 [`src/config/types.ts`](src/config/types.ts)에 한국어 주석으로 정리되어 있습니다.
2. **검사하기**: `npm run check-config -- configs/새파일.json` (Claude Code에게 "config 검사해줘"라고 해도 됩니다)
3. **앱에 넣기**: 관리자 → **대회 설정 → 파일 → JSON 파일 불러오기** → 확인 → **변경 내용 저장**
   - 대회 ID(`id`, 예: `2027-우리중`)가 다르면 새 대회로 저장되고, 지난 대회 데이터는 그대로 남습니다.
4. **세부 수정**: 앱 안의 대회 설정 화면에서 학급·종목·배점·시나리오를 추가/삭제/순서 변경할 수 있습니다.
5. **다른 학교**: 그 학교에서 Firebase 프로젝트를 만들고 앱의 [학교 연결]에 붙여넣기만 하면 됩니다(코드 수정 불필요).

### 설정 파일의 주요 항목

| 항목 | 의미 |
|---|---|
| `grades` | 학년별 학급 수. `{ "grade": 2, "classCount": 8 }` → 2-1 ~ 2-8 |
| `events[].format.type` | `single_elim` 토너먼트 / `round_robin` 리그 / `groups_knockout` 조별리그+토너먼트 / `ranking` 순위제 |
| `events[].format.rankBy` | 순위제만: `rank` 순위 직접 입력 / `record_low` 기록 낮을수록 위(시간) / `record_high` 기록 높을수록 위(횟수) |
| `events[].match` | `{ "mode": "sets", "setsToWin": 2 }` = 3판 2선승, `{ "mode": "score", "allowDraw": true }` = 점수제·무승부 가능 |
| `events[].points` | `byRank` 순위별 점수, `participation` 참가점, `leagueWin/Draw/Loss` 리그 승점, `weight` 가중치 |
| `scenario[]` | `time` 계획 시각, `durationMin` 소요 분, `owner` 담당자, `note` 방송 멘트(관리자만 보임) |
| `scoring.bonusCategories` | 응원·질서 점수, 감점 항목 |
| `scoring.tieBreakers` | 동점 처리 순서 (4단계에서 설정 화면 제공) |

---

## 🔒 데이터 구조와 순위 비공개 원리

```
meta/active                         공개    현재 대회 ID
meta/admins                         관리자  관리자 UID 목록 (최초 1명 자기등록, 이후 콘솔에서만 수정)
tournaments/{대회}/public/info      공개    학급·종목 이름 (배점 없음)
tournaments/{대회}/public/progress  공개    진행 순서·완료 여부 (방송 멘트 없음)
tournaments/{대회}/public/bracket_{종목}  공개  대진표 구조
tournaments/{대회}/public/results_{종목}  공개  경기 결과·기록(승패·스코어). 관리자 + 그 종목 심판만 쓰기
tournaments/{대회}/private/referee  관리자  종목별 심판 링크 토큰·PIN
tournaments/{대회}/refSessions/{기기}  심판  PIN이 확인된 심판 기기(이름)
tournaments/{대회}/private/*        관리자  설정(배점), 시나리오 기록, 대진표 원본(메모 포함), 점수
tournaments/{대회}/audit/*          관리자  변경 이력 (추가만 가능, 수정 불가)
```

- 공개 화면(전광판)은 `public/` 문서만 읽습니다. `public/` 에는 총점·순위·종목별 획득 점수 필드가 **처음부터 존재하지 않습니다.**
- 심판은 링크(무작위 토큰)와 PIN이 모두 맞아야 '심판 세션'을 만들 수 있고, 그 종목의 결과 칸만 고칠 수 있습니다. 관리자가 PIN을 새로 만들면 예전 심판 기기는 바로 막힙니다.
- 관리자 최초 등록은 '관리자 목록이 아직 없을 때, Google 로그인한 사람이 자기 자신만' 가능합니다. 익명(심판·학생 기기)은 불가.
- `private/`, `audit/`, `meta/admins` 는 보안 규칙으로 관리자만 읽을 수 있습니다. 개발자도구로 직접 요청해도 `403 PERMISSION_DENIED`.
- 관리자 화면의 코드도 관리자 주소에 들어갈 때만 내려받으므로, 전광판 기기에는 배점 관련 코드가 전달되지 않습니다.
- 이 내용은 `npm run test:rules` 자동 테스트로 매 배포마다 검증합니다.

> ⚠️ 경기 승패를 공개하고 배점표까지 알려지면, 누군가 직접 계산해 총점을 추정할 수는 있습니다.
> 배점표는 공개하지 않고, 후반에는 '블라인드(5단계)'를 켜는 것을 권장합니다.

---

## 개발자용 명령어 (Claude Code가 사용)

```bash
npm install          # 처음 한 번
npm test             # 단위 테스트(설정 검사, 시나리오 계산 등)
npm run test:rules   # 보안 규칙 테스트 (Java 필요, 에뮬레이터 자동 실행)
npm run emulators    # 로컬 Firebase 에뮬레이터 실행
npm run seed         # 에뮬레이터에 테스트 관리자(admin@test.local / test1234) 등록
npm run dev:emu      # 에뮬레이터에 연결된 개발 서버
npm run build        # 배포용 빌드
```

`main` 브랜치에 올리면 GitHub Actions가 테스트 → 빌드 → GitHub Pages 배포를 자동으로 합니다.
