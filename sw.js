// 离线壳缓存：首开时缓存全部静态资源，之后断网也能打开和浏览已入柜的卡。
// 图片本体存 IndexedDB（db.js），不走这里。

const CACHE_VERSION = 'v1';
const CACHE_NAME = `shell-${CACHE_VERSION}`;

// 预缓存清单：站点壳的全部文件，新增静态资源后记得同步这里。
const PRECACHE_URLS = [
  './',
  './index.html',
  './styles/tokens.css',
  './styles/app.css',
  './manifest.webmanifest',
  './assets/icon.svg',
  './js/app.js',
  './js/ui.js',
  './js/db.js',
  './js/model.js',
  './js/query.js',
  './js/bundle.js',
  './js/geom.js',
  './js/image.js',
  './js/prefs.js',
  './js/tilt.js',
  './js/poster.js',
  './js/transfer.js',
  './js/import-flow.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 导航：网络优先，断网时回落到缓存的 index.html（SPA 壳不变，直接复用）。
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // 顺手把最新版放回缓存，保证下次离线拿到的壳是新的。
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 其余同源静态资源：缓存优先，命中后后台刷新（stale-while-revalidate）。
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
