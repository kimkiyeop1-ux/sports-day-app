import { doc, getDocFromServer } from 'firebase/firestore';
import { db } from './firebase';

/** firestore.rules 의 meta/rulesCheck_v? 숫자와 같아야 한다 */
export const RULES_VERSION = 3;

export type RulesStatus = 'ok' | 'outdated' | 'offline' | 'error';

/**
 * 이 학교 Firebase에 최신 보안 규칙이 붙여넣어져 있는지 확인.
 * 최신 규칙에만 있는 '확인용 경로'를 읽어 보고, 거부되면 규칙이 오래된(또는 아직 안 붙인) 것.
 */
export async function checkRules(): Promise<{ status: RulesStatus; detail?: string }> {
  if (!navigator.onLine) return { status: 'offline' };
  try {
    await getDocFromServer(doc(db, `meta/rulesCheck_v${RULES_VERSION}`));
    return { status: 'ok' };
  } catch (e: any) {
    if (e?.code === 'permission-denied') return { status: 'outdated' };
    if (e?.code === 'unavailable') return { status: 'offline' };
    return { status: 'error', detail: e?.code ?? e?.message };
  }
}
