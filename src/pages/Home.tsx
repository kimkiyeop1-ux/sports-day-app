import { Link } from 'react-router-dom';
import { connection, isConfigured } from '../lib/firebase';

export default function Home() {
  return (
    <div className="page">
      <h1>🏃 체육대회 원앱</h1>
      <p className="muted">체육대회 하루를 이 앱 하나로 운영해요. 누가 쓰나요?</p>
      {!isConfigured && (
        <div className="alert alert-warn">
          처음이신가요? 먼저 <Link to="/connect">🏫 학교 연결</Link>을 해 주세요. 한 번만 하면 돼요.
        </div>
      )}
      <div className="mode-list">
        <Link className="mode" to="/admin">
          <b>🧑‍🏫 선생님 (관리자)</b>
          <span className="muted">대회 준비, 진행표, 경기 결과, 점수, 순위 발표</span>
        </Link>
        <Link className="mode" to="/board">
          <b>📺 전광판</b>
          <span className="muted">지금 하는 순서를 TV에 크게 보여 줘요</span>
        </Link>
        <Link className="mode" to="/bracket">
          <b>📋 학생용 대진표</b>
          <span className="muted">누가 누구와 경기하는지, 결과는 어떤지 봐요</span>
        </Link>
      </div>
      <p className="muted small" style={{ marginTop: 16 }}>
        🧑‍⚖️ 심판 선생님은 받은 링크(QR)로 들어오면 돼요.
        {isConfigured && (
          <>
            {' '}· 연결된 학교: <b>{connection?.projectId}</b> (<Link to="/connect">확인</Link>)
          </>
        )}
      </p>
    </div>
  );
}
