import { initializeApp } from 'firebase/app';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { resolveConnection, type Connection } from './connection';

/** 로컬 개발용 에뮬레이터 사용 여부 (npm run dev:emu) */
export const USE_EMULATOR = import.meta.env.VITE_USE_EMULATOR === '1';

const EMULATOR_CONN: Connection = { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-sportsday', appId: 'demo' };

/** 현재 연결된 학교(Firebase 프로젝트). 연결 전이면 null */
export const connection: Connection | null = USE_EMULATOR ? EMULATOR_CONN : resolveConnection();
export const isConfigured = connection != null;

// 연결 전에도 화면이 깨지지 않도록 가짜 값으로 초기화(이때는 어떤 데이터도 읽지 않음)
const app = initializeApp(connection ?? { apiKey: 'not-connected', projectId: 'not-connected', appId: 'not-connected' });

// 오프라인 캐시: 와이파이가 끊겨도 마지막 데이터를 보여주고, 입력은 기기에 저장했다가 재연결 시 자동 전송
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const auth = getAuth(app);

if (USE_EMULATOR) {
  const host = location.hostname;
  connectFirestoreEmulator(db, host, 8080);
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
}
