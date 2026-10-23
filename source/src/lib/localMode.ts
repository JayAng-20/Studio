/**
 * 本機伺服器模式：從 localhost／127.0.0.1／[::1] 開啟時，不安裝 Service Worker、不留離線快取，
 * localStorage 由 index.html 的內嵌腳本換成 sessionStorage（關閉分頁就消失），
 * 錄影庫（IndexedDB）預設關閉，並在新分頁開啟時清掉上次殘留的資料。
 */

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0)$/i

export function isLocalHost(host = typeof location !== 'undefined' ? location.hostname : '') {
  return LOOPBACK.test(host) || /\.localhost$/i.test(host)
}

export const localMode = isLocalHost()

/** 解除所有 Service Worker、刪除 Cache Storage */
export async function removeServiceWorkers() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
    await Promise.all(regs.map((r) => r.unregister()))
  } catch {
    /* 忽略 */
  }
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys()
      await Promise.all(names.map((n) => caches.delete(n)))
    }
  } catch {
    /* 忽略 */
  }
}

/** 刪除這個網站的所有 IndexedDB 資料庫 */
export async function deleteDatabases() {
  try {
    const list = (await indexedDB.databases?.()) ?? []
    const names = new Set(list.map((d) => d.name).filter(Boolean) as string[])
    names.add('jayang-recordings')
    names.add('keyval-store')
    await Promise.all(
      [...names].map(
        (n) =>
          new Promise<void>((res) => {
            const req = indexedDB.deleteDatabase(n)
            req.onsuccess = req.onerror = req.onblocked = () => res()
          }),
      ),
    )
  } catch {
    /* 忽略 */
  }
}

/** 清除這個網站在瀏覽器裡的所有資料（不含 Cookie；本站不使用 Cookie） */
export async function wipeSiteData() {
  await removeServiceWorkers()
  await deleteDatabases()
  for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
    try {
      store?.clear()
    } catch {
      /* 忽略 */
    }
  }
  // 真正的 localStorage（本機模式下 window.localStorage 已換成 sessionStorage）
  try {
    ;(window as unknown as { __realLocalStorage?: Storage }).__realLocalStorage?.clear()
  } catch {
    /* 忽略 */
  }
}

/** 本機模式啟動時：清掉 Service Worker、快取，以及上一個分頁留下的 IndexedDB */
export async function cleanupLocalLeftovers() {
  if (!localMode) return
  await removeServiceWorkers()
  try {
    if (!sessionStorage.getItem('jayang:session')) {
      sessionStorage.setItem('jayang:session', '1')
      await deleteDatabases()
    }
  } catch {
    /* 忽略 */
  }
}
