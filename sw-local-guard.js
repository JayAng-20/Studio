// 本機伺服器（localhost／127.0.0.1）上不應該有 Service Worker：
// 舊版本留下的 Service Worker 更新到這一版時，立即接手、刪除所有快取、解除註冊並重新載入頁面。
;(function () {
  var host = self.location.hostname
  var local =
    /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0)$/i.test(host) || /\.localhost$/i.test(host)
  if (!local) return
  self.addEventListener('install', function () {
    self.skipWaiting()
  })
  self.addEventListener('activate', function (event) {
    event.waitUntil(
      caches
        .keys()
        .then(function (names) {
          return Promise.all(names.map(function (n) { return caches.delete(n) }))
        })
        .then(function () { return self.registration.unregister() })
        .then(function () { return self.clients.matchAll({ type: 'window' }) })
        .then(function (clients) {
          clients.forEach(function (c) { c.navigate(c.url) })
        }),
    )
  })
  // 在接手之前就不要再從快取回應
  self.addEventListener('fetch', function (event) {
    event.stopImmediatePropagation()
  })
})()
