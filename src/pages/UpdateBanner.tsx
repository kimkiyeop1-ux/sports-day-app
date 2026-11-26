import { useEffect, useState } from 'react';
import { applyUpdate, onUpdateReady } from '../lib/pwa';

/** 새 버전이 준비되면 화면 아래에 작게 알림(대회 중 갑자기 바뀌지 않도록 누를 때만 교체) */
export default function UpdateBanner() {
  const [ready, setReady] = useState(false);
  useEffect(() => onUpdateReady(setReady), []);
  if (!ready) return null;
  return (
    <div className="update-banner" role="status">
      <span>새 버전이 준비되었습니다.</span>
      <button className="btn-sm" onClick={applyUpdate}>새로고침</button>
      <button className="btn-sm" onClick={() => setReady(false)} aria-label="닫기">나중에</button>
    </div>
  );
}
