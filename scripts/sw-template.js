// 오프라인 앱 셸(서비스 워커) — 빌드할 때 scripts/sw-template.js 로부터 dist/sw.js 가 만들어진다.
// 화면 파일(HTML·JS·CSS·아이콘)을 기기에 저장해 두어, 인터넷이 끊겨도 앱이 열린다.
// 대회 데이터는 Firebase가 따로 기기에 저장(오프라인 캐시)하므로 여기서는 다루지 않는다.
const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = 'sportsday-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('sportsday-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// 화면에서 [새로고침] 버튼을 누르면 새 버전으로 바로 교체
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 이 앱 주소 밖(Firebase·Google 로그인 등)은 건드리지 않는다
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL('./', self.location).pathname)) return;
  if (req.mode === 'navigate') {
    // 페이지: 인터넷 되면 최신, 안 되면 저장본
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./', { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
    );
    return;
  }
  // 파일(이름에 해시가 붙어 있어 바뀌지 않음): 저장본 먼저
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && (url.pathname.includes('/assets/') || url.pathname.includes('/sounds/'))) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
