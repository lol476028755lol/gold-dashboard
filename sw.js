/* Service Worker：壳资源缓存优先；data.json 网络优先以拿到最新采集值，离线回退缓存 */
const CACHE = "gold-dashboard-v22";
const CORE = [
  "./",
  "index.html",
  "css/styles.css",
  "js/app.js",
  "js/chart.js",
  "manifest.webmanifest",
  "data.example.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon.svg"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;

  // data.json：network-first，失败用缓存兜底
  if (url.pathname.endsWith("data.json")) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("data.json", copy));
          return res;
        })
        .catch(() => caches.match("data.json").then((r) => r || caches.match("data.example.json")))
    );
    return;
  }

  // 其余壳资源：cache-first
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
