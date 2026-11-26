// 관리자: 종목별 심판 링크·PIN 만들기, QR, 접속한 심판 목록
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useAdmin } from './AdminLayout';
import { connection } from '../../lib/firebase';
import { shareLink } from '../../lib/connection';
import { useCollection, useDoc } from '../../data/hooks';
import { createRefKey, paths, type RefKey, type RefKeysDoc, type RefSessionDoc } from '../../data/store';
import type { EventConfig } from '../../config/types';

export default function RefereeAdmin() {
  const { tid, config } = useAdmin();
  const keys = useDoc<RefKeysDoc>(tid ? paths.refKeys(tid) : null);
  const sessions = useCollection<RefSessionDoc>(tid ? paths.refSessions(tid) : null);
  if (!config || !tid) return <p>먼저 대시보드에서 대회를 시작하세요.</p>;
  if (keys.loading) return <p className="muted">불러오는 중…</p>;
  return (
    <>
      <h1>심판 링크 · PIN</h1>
      <div className="card muted small stack">
        <p style={{ margin: 0 }}>
          종목마다 <b>링크 1개 + 6자리 PIN</b>을 만들어 심판 선생님께 보내세요. 링크를 열고 이름과 PIN을 넣으면 그 종목의 결과만 입력할 수 있습니다.
        </p>
        <p style={{ margin: 0 }}>링크와 PIN을 따로 보내면 더 안전합니다(예: 링크는 메신저, PIN은 말로). [새로 만들기]를 누르면 예전 링크·PIN으로 들어온 기기는 모두 다시 PIN을 넣어야 합니다.</p>
      </div>
      {config.events.map((ev) => (
        <EventKey key={ev.id} tid={tid} ev={ev} k={keys.data?.keys?.[ev.id]}
          names={sessions.docs.filter((s) => s.ev === ev.id && keys.data?.keys?.[ev.id]?.token === s.token && keys.data?.keys?.[ev.id]?.pin === s.pin).map((s) => s.name)} />
      ))}
    </>
  );
}

function EventKey({ tid, ev, k, names }: { tid: string; ev: EventConfig; k?: RefKey; names: string[] }) {
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const link = k && connection ? shareLink(connection, `/ref/${ev.id}/${k.token}`) : null;

  useEffect(() => {
    setQr(null);
    if (link) QRCode.toDataURL(link, { margin: 1, width: 280 }).then(setQr).catch(() => setQr(null));
  }, [link]);

  const make = async () => {
    if (k && !confirm(`"${ev.name}" 심판 링크·PIN을 새로 만들까요?\n이미 들어와 있는 심판 기기는 새 PIN을 다시 넣어야 합니다.`)) return;
    setBusy(true);
    try {
      await createRefKey(tid, ev, k);
    } catch (e: any) {
      alert('만들기 실패: ' + e.message + '\n(보안 규칙이 최신인지 학교 연결 화면에서 확인하세요)');
    } finally {
      setBusy(false);
    }
  };
  const copy = (text: string, what: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  return (
    <div className="card stack">
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>{ev.name}</h2>
        {k && <span className="badge badge-ok">접속한 심판 {names.length}명</span>}
      </div>
      {!k ? (
        <button className="btn-primary" disabled={busy} onClick={make}>심판 링크·PIN 만들기</button>
      ) : (
        <>
          <div className="row">
            <span className="muted small">PIN</span>
            <b className="pin">{k.pin}</b>
          </div>
          <div className="row">
            <input readOnly value={link ?? ''} className="grow" onFocus={(e) => e.target.select()} aria-label={`${ev.name} 심판 링크`} />
          </div>
          <div className="row">
            <button className="btn-sm" onClick={() => link && copy(link, 'link')}>{copied === 'link' ? '✅ 복사됨' : '링크 복사'}</button>
            <button className="btn-sm" onClick={() => link && copy(`[${ev.name} 심판 입력]\n${link}\nPIN: ${k.pin}`, 'msg')}>
              {copied === 'msg' ? '✅ 복사됨' : '안내문 복사(링크+PIN)'}
            </button>
            <button className="btn-sm" onClick={() => setShowQr(!showQr)}>{showQr ? 'QR 닫기' : 'QR 코드'}</button>
            <span className="grow" />
            <button className="btn-sm btn-danger" disabled={busy} onClick={make}>새로 만들기</button>
          </div>
          {showQr && qr && (
            <div style={{ textAlign: 'center' }}>
              <img src={qr} alt={`${ev.name} 심판 링크 QR`} width={240} height={240} />
              <div className="muted small">휴대폰 카메라로 찍으면 바로 열립니다. PIN은 따로 알려 주세요.</div>
            </div>
          )}
          {names.length > 0 && <p className="muted small" style={{ margin: 0 }}>접속한 심판: {names.join(', ')}</p>}
        </>
      )}
    </div>
  );
}
