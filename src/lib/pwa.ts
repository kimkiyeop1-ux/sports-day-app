// 서비스 워커 등록(배포판에서만). 새 버전이 준비되면 알려 준다.
type Listener = (ready: boolean) => void;
let waiting: ServiceWorker | null = null;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l(!!waiting));

export function onUpdateReady(l: Listener): () => void {
  listeners.add(l);
  l(!!waiting);
  return () => listeners.delete(l);
}

/** 새 버전으로 바꾸고 다시 불러오기 */
export function applyUpdate() {
  if (!waiting) return location.reload();
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waiting.postMessage('skipWaiting');
}

export function registerSW() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD || import.meta.env.VITE_USE_EMULATOR === '1') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        const track = (sw: ServiceWorker | null) => {
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            // 처음 설치할 때는 알리지 않음(이미 최신). 기존 버전이 있을 때만 '업데이트 있음'
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              waiting = sw;
              emit();
            }
          });
        };
        if (reg.waiting && navigator.serviceWorker.controller) {
          waiting = reg.waiting;
          emit();
        }
        reg.addEventListener('updatefound', () => track(reg.installing));
        // 오래 켜 두는 전광판도 새 버전을 알 수 있게 30분마다 확인
        setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
      })
      .catch(() => {});
  });
}
