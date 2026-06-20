// Rizance PWA service worker — minimal, network passthrough
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // network-first passthrough; ไม่ intercept เพื่อกัน stale data
  // (มีไว้เพื่อให้ Chrome ถือว่าแอป installable เท่านั้น)
  return;
});
