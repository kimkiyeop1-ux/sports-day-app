import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db, isConfigured } from '../lib/firebase';
import { paths } from './store';

export interface DocState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** 아직 서버로 전송되지 않은 변경이 있음(오프라인 등) */
  pending: boolean;
  /** 서버가 아닌 기기 캐시에서 읽은 값 */
  fromCache: boolean;
}

/** Firestore 문서 하나를 실시간으로 구독 */
export function useDoc<T>(path: string | null): DocState<T> {
  const [s, setS] = useState<DocState<T>>({ data: null, loading: true, error: null, pending: false, fromCache: false });
  useEffect(() => {
    if (!path || !isConfigured) {
      setS({ data: null, loading: false, error: null, pending: false, fromCache: false });
      return;
    }
    setS((p) => ({ ...p, loading: true }));
    return onSnapshot(
      doc(db, path),
      { includeMetadataChanges: true },
      (snap) =>
        setS({
          data: snap.exists() ? (snap.data() as T) : null,
          loading: false,
          error: null,
          pending: snap.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache,
        }),
      (err) => setS({ data: null, loading: false, error: err.code ?? err.message, pending: false, fromCache: false }),
    );
  }, [path]);
  return s;
}

export function useAuthUser(): { user: User | null; ready: boolean } {
  const [state, setState] = useState<{ user: User | null; ready: boolean }>({ user: auth.currentUser, ready: false });
  useEffect(() => onAuthStateChanged(auth, (user) => setState({ user, ready: true })), []);
  return state;
}

/** 현재 대회 ID (meta/active) */
export function useActiveTournament(): { tid: string | null; loading: boolean } {
  const s = useDoc<{ tournamentId: string }>(paths.active);
  return { tid: s.data?.tournamentId ?? null, loading: s.loading };
}

export function useOnline(): boolean {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return on;
}

/** 1초(기본)마다 현재 시각을 갱신 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
