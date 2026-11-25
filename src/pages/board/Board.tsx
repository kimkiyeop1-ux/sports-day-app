import { useEffect } from 'react';
import { useActiveTournament, useDoc, useNow, useOnline } from '../../data/hooks';
import { paths, type ProgressDoc } from '../../data/store';
import type { PublicInfo } from '../../config/derive';
import { computeProgress } from '../../lib/scenario';
import { clockHM, delayLabel } from '../../lib/time';
import { isConfigured } from '../../lib/firebase';

/**
 * 전광판(공개) 화면 — 로그인 없음.
 * 읽는 데이터: meta/active, public/info, public/progress 뿐 (점수·배점 없음)
 */
export default function Board() {
  const { tid } = useActiveTournament();
  const info = useDoc<PublicInfo>(tid ? paths.publicInfo(tid) : null);
  const prog = useDoc<ProgressDoc>(tid ? paths.publicProgress(tid) : null);
  const now = useNow(1000);
  const online = useOnline();

  // 화면 꺼짐 방지(지원하는 브라우저에서만)
  useEffect(() => {
    let lock: any;
    const req = async () => {
      try {
        lock = await (navigator as any).wakeLock?.request('screen');
      } catch {
        /* 무시 */
      }
    };
    req();
    document.addEventListener('visibilitychange', req);
    return () => {
      document.removeEventListener('visibilitychange', req);
      lock?.release?.();
    };
  }, []);

  const fullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  };

  if (!isConfigured) return <div className="board"><div className="board-mid">Firebase 설정이 필요합니다.</div></div>;

  const items = prog.data?.items ?? [];
  const done = Object.fromEntries(items.filter((i) => i.doneAt != null).map((i) => [i.id, i.doneAt as number]));
  const p = computeProgress(items, done, now);
  const eventName = (id: string | null) => info.data?.events.find((e) => e.id === id);
  const curEv = eventName(p.current?.eventId ?? null);

  return (
    <div className="board" onDoubleClick={fullscreen}>
      <div className="board-head">
        <div className="board-title">{info.data?.title ?? '체육대회'}</div>
        <div className="board-clock">{clockHM(now)}</div>
      </div>

      <div className="board-now">
        <div className="board-label">지금 진행 중</div>
        <div className="board-big">{p.current?.title ?? (items.length ? '모든 순서가 끝났습니다' : '준비 중')}</div>
        {p.current && (
          <div className="board-sub">
            계획 {p.current.time}
            {curEv?.location ? ` · ${curEv.location}` : ''}
            {'  '}
            {p.delayMin > 0 && <span className="board-delay">{delayLabel(p.delayMin)}</span>}
          </div>
        )}
      </div>

      {p.next && (
        <div className="board-next">
          <div className="board-label">다음 순서</div>
          <div className="board-mid">
            {p.next.time} {p.next.title}
          </div>
        </div>
      )}

      <div className="board-foot">
        <span>
          진행 {p.doneCount}/{p.total}
        </span>
        <span>{online ? (prog.fromCache ? '연결 중…' : '● 실시간') : '⚠ 오프라인 (마지막 정보 표시 중)'}</span>
      </div>
    </div>
  );
}
