// 더보기: 자주 쓰지 않는 기능을 한곳에
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { connection } from '../../lib/firebase';
import { shareLink } from '../../lib/connection';
import { useAdmin } from './AdminLayout';

export default function More() {
  const { config } = useAdmin();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, text: string) =>
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  const board = connection ? shareLink(connection, '/board') : '#/board';
  const bracket = connection ? shareLink(connection, '/bracket') : '#/bracket';
  return (
    <>
      <h1>더보기</h1>

      <h2 className="more-h">📺 큰 화면·학생 화면</h2>
      <div className="more-list">
        <div className="more-item">
          <div className="grow">
            <b>전광판</b>
            <p>지금 무엇을 하는지, 다음은 무엇인지 크게 보여 줘요. TV나 프로젝터에 띄우세요.</p>
          </div>
          <div className="row">
            <a className="btn btn-sm" href="#/board" target="_blank" rel="noreferrer">열기 ↗</a>
            <button className="btn-sm" onClick={() => copy('board', board)}>{copied === 'board' ? '✅ 복사됨' : '링크 복사'}</button>
          </div>
        </div>
        <div className="more-item">
          <div className="grow">
            <b>학생용 대진표</b>
            <p>경기 대진과 결과를 누구나 볼 수 있어요. 총점과 순위는 나오지 않아요.</p>
          </div>
          <div className="row">
            <a className="btn btn-sm" href="#/bracket" target="_blank" rel="noreferrer">열기 ↗</a>
            <button className="btn-sm" onClick={() => copy('bracket', bracket)}>{copied === 'bracket' ? '✅ 복사됨' : '링크 복사'}</button>
          </div>
        </div>
      </div>

      <h2 className="more-h">🛠 관리</h2>
      <div className="more-list">
        <Link className="more-item more-link" to="/admin/referee">
          <div className="grow">
            <b>🧑‍⚖️ 심판 링크</b>
            <p>심판 선생님 폰으로 경기 결과를 넣을 수 있게 링크와 비밀번호(PIN)를 만들어요.</p>
          </div>
          <span>›</span>
        </Link>
        <Link className="more-item more-link" to="/admin/history">
          <div className="grow">
            <b>📝 고친 기록</b>
            <p>누가 언제 무엇을 바꿨는지 봐요. 잘못 넣은 결과를 되돌릴 수 있어요.</p>
          </div>
          <span>›</span>
        </Link>
        <Link className="more-item more-link" to="/admin/backup">
          <div className="grow">
            <b>{config?.rehearsalOf ? '🎭 연습 모드 끝내기 · 💾 파일로 저장' : '🎭 연습 모드 · 💾 파일로 저장'}</b>
            <p>대회 전에 미리 연습해 보거나, 결과를 엑셀 파일로 저장해요.</p>
          </div>
          <span>›</span>
        </Link>
        <Link className="more-item more-link" to="/connect">
          <div className="grow">
            <b>🏫 학교 연결</b>
            <p>우리 학교 저장 공간(Firebase) 연결 상태를 확인해요.</p>
          </div>
          <span>›</span>
        </Link>
      </div>
    </>
  );
}
