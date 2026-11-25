import { Link } from 'react-router-dom';
import { connection, isConfigured } from '../lib/firebase';

export default function Home() {
  return (
    <div className="page">
      <h1>🏃 체육대회 원앱</h1>
      <p className="muted">사용할 화면을 고르세요.</p>
      {!isConfigured ? (
        <div className="alert alert-warn">
          아직 학교가 연결되지 않았습니다. 먼저 <Link to="/connect">🏫 학교 연결</Link>을 해 주세요.
        </div>
      ) : (
        <p className="small">
          연결된 학교 프로젝트: <b>{connection?.projectId}</b> · <Link to="/connect">학교 연결·점검</Link>
        </p>
      )}
      <div className="mode-list">
        <Link className="mode" to="/admin">
          <b>🛠 관리자</b>
          <span className="muted">대회 설정, 시나리오 진행, 대진표, 점수·순위 (Google 로그인)</span>
        </Link>
        <Link className="mode" to="/board">
          <b>📺 전광판</b>
          <span className="muted">현재 진행 중·다음 순서를 크게 표시 (로그인 없음)</span>
        </Link>
        <Link className="mode" to="/bracket">
          <b>📋 대진표 · 경기 결과</b>
          <span className="muted">종목별 대진표와 경기 결과 (로그인 없음, 학생·학부모 공유용)</span>
        </Link>
        <div className="mode" style={{ opacity: 0.6 }}>
          <b>🧑‍⚖️ 심판 입력</b>
          <span className="muted">관리자가 나눠 준 종목별 링크(QR)로 들어옵니다. (3단계에서 추가)</span>
        </div>
      </div>
    </div>
  );
}
