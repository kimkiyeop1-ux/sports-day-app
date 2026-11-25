import type { TournamentConfig } from './types';

/** 샘플 설정은 필요할 때만 내려받는다(전광판 코드에 배점이 섞이지 않도록) */
export async function loadSample(): Promise<TournamentConfig> {
  const m = await import('../../configs/sample-2026.json');
  return structuredClone(m.default) as TournamentConfig;
}
