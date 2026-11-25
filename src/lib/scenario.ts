import type { ScenarioItem } from '../config/types';
import { minutesOfDay, parseHM } from './time';

/** 공개 진행 화면에 내보내는 시나리오 한 줄(방송 멘트·담당자는 제외) */
export interface PublicScenarioItem {
  id: string;
  time: string;
  durationMin: number;
  title: string;
  eventId: string | null;
  doneAt: number | null;
}

export type DoneMap = Record<string, number>; // 항목ID → 완료 시각(ms)

export function toPublicScenario(items: ScenarioItem[], done: DoneMap): PublicScenarioItem[] {
  return items.map((s) => ({
    id: s.id,
    time: s.time,
    durationMin: s.durationMin,
    title: s.title,
    eventId: s.eventId ?? null,
    doneAt: done[s.id] ?? null,
  }));
}

/** 계획상 종료 시각(분) */
export function plannedEnd(item: { time: string; durationMin: number }): number {
  return (parseHM(item.time) ?? 0) + (item.durationMin || 0);
}

/** 완료된 항목의 지연(분). 양수 = 늦게 끝남, 음수 = 일찍 끝남 */
export function itemDelay(item: { time: string; durationMin: number }, doneAt: number): number {
  return minutesOfDay(doneAt) - plannedEnd(item);
}

export interface ProgressView<T> {
  current: T | null;
  next: T | null;
  doneCount: number;
  total: number;
  /** 현재 일정 지연(분). 가장 최근 완료 항목 기준 + 진행 중 항목이 계획보다 길어지면 반영 */
  delayMin: number;
}

/**
 * 진행 상황 계산. items는 목록 순서(=진행 순서) 그대로 사용.
 * 현재 = 아직 완료되지 않은 첫 항목, 다음 = 그다음 미완료 항목.
 */
export function computeProgress<T extends { id: string; time: string; durationMin: number }>(
  items: T[],
  done: DoneMap,
  nowMs: number,
): ProgressView<T> {
  const pending = items.filter((i) => done[i.id] == null);
  const current = pending[0] ?? null;
  const next = pending[1] ?? null;

  let delay = 0;
  let lastDoneAt = -1;
  for (const i of items) {
    const at = done[i.id];
    if (at != null && at > lastDoneAt) {
      lastDoneAt = at;
      delay = itemDelay(i, at);
    }
  }
  if (current) {
    // 진행 중 항목이 계획 종료 시각을 넘겼다면 그만큼은 이미 지연된 것
    const overrun = minutesOfDay(nowMs) - plannedEnd(current);
    if (overrun > delay) delay = overrun;
  }
  return { current, next, doneCount: items.length - pending.length, total: items.length, delayMin: Math.round(delay) };
}
