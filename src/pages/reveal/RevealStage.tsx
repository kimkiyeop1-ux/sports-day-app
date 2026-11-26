// 최종 순위 발표 무대(큰 화면용). 아래 순위부터 하나씩 공개, 3위부터는 드럼 소리 후 공개.
// 조작: 화면 클릭·스페이스·→ = 다음 / ← = 이전 / F = 전체화면 / Esc = 나가기
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RevealDoc, RevealRow } from '../../data/store';
import { playCymbal, playDing, playDrumroll, playFanfare, preloadSounds, unlockAudio } from '../../lib/sound';

const classText = (id: string) => {
  const [g, c] = id.split('-');
  return `${g}학년 ${c}반`;
};
const fmt = (n?: number) => (n == null ? '' : Number.isInteger(n) ? `${n}점` : `${n.toFixed(2).replace(/0$/, '')}점`);

export default function RevealStage({ doc, title, onExit }: { doc: RevealDoc; title: string; onExit: () => void }) {
  // 발표 순서: 아래 순위부터
  const order: RevealRow[] = useMemo(() => {
    const list = doc.topN > 0 ? doc.rows.filter((r) => r.rank <= doc.topN) : doc.rows;
    return [...list].sort((a, b) => b.rank - a.rank || b.id.localeCompare(a.id, undefined, { numeric: true }));
  }, [doc]);
  const [step, setStep] = useState(0); // 공개한 학급 수
  const [drum, setDrum] = useState(false);
  const [sound, setSound] = useState(true);
  const busy = useRef(false);
  const sharedCount = (r: RevealRow) => doc.rows.filter((x) => x.rank === r.rank).length;

  useEffect(() => preloadSounds(), []);

  const next = useCallback(async () => {
    if (busy.current || step >= order.length) return;
    unlockAudio();
    const target = order[step];
    busy.current = true;
    if (target.rank <= 3) {
      setDrum(true);
      if (sound) await playDrumroll(target.rank === 1 ? 3 : 2.2);
      else await new Promise((r) => setTimeout(r, 1200));
      setDrum(false);
      if (sound) {
        void playCymbal();
        if (target.rank === 1) void playFanfare();
      }
    } else if (sound) void playDing();
    setStep((s) => s + 1);
    busy.current = false;
  }, [step, order, sound]);

  const prev = useCallback(() => !busy.current && setStep((s) => Math.max(0, s - 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        void next();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev();
      else if (e.key === 'f' || e.key === 'F') document.documentElement.requestFullscreen?.().catch(() => {});
      else if (e.key === 'Escape' && !document.fullscreenElement) onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onExit]);

  const current = step > 0 ? order[step - 1] : null;
  const shown = order.slice(0, Math.max(0, step - 1)); // 이미 지나간 학급(작게)
  const finished = step >= order.length && order.length > 0;
  const champion = finished && current?.rank === 1;

  return (
    <div className="rv" onClick={() => void next()}>
      <div className="rv-top" onClick={(e) => e.stopPropagation()}>
        <span className="rv-title">{title}</span>
        <span className="grow" />
        <button className="rv-btn" onClick={() => setSound(!sound)}>{sound ? '🔊 소리 켬' : '🔇 소리 끔'}</button>
        <button className="rv-btn" onClick={prev} disabled={step === 0}>◀ 이전</button>
        <button className="rv-btn" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}>⛶ 전체화면</button>
        <button className="rv-btn" onClick={onExit}>나가기</button>
      </div>

      <div className="rv-main">
        {drum ? (
          <div className="rv-drum">
            <div className="rv-drum-icon">🥁</div>
            <div className="rv-drum-text">{order[step]?.rank}위는…</div>
          </div>
        ) : current ? (
          <div key={step} className={`rv-card rv-rank${Math.min(current.rank, 4)}`}>
            <div className="rv-rank-text">{sharedCount(current) > 1 ? `공동 ${current.rank}위` : `${current.rank}위`}</div>
            <div className="rv-class">{classText(current.id)}</div>
            {doc.showScores && <div className="rv-score">{fmt(current.total)}</div>}
          </div>
        ) : (
          <div className="rv-intro">
            <div className="rv-intro-1">🏆 최종 순위 발표</div>
            <div className="rv-intro-2">{doc.topN > 0 ? `${doc.topN}위부터 1위까지` : `${order.length}개 학급`} · 화면을 누르면 시작합니다</div>
          </div>
        )}
      </div>

      {shown.length > 0 && (
        <div className="rv-list">
          {[...shown].reverse().map((r) => (
            <span key={r.id} className="rv-chip">
              <b>{sharedCount(r) > 1 ? `공동${r.rank}` : r.rank}위</b> {r.id}
              {doc.showScores && r.total != null ? ` · ${fmt(r.total)}` : ''}
            </span>
          ))}
        </div>
      )}

      {champion && <Confetti />}
      {!finished && !drum && <div className="rv-hint">{step === 0 ? '' : '다음: 화면 클릭 / 스페이스'}</div>}
      {finished && <div className="rv-hint">🎉 모든 학급 수고했습니다!</div>}
    </div>
  );
}

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 80 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 1.5,
        dur: 2.5 + Math.random() * 2,
        color: ['#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#a855f7', '#f472b6'][i % 6],
        rot: Math.random() * 360,
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p, i) => (
        <span key={i} style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, background: p.color, transform: `rotate(${p.rot}deg)` }} />
      ))}
    </div>
  );
}
