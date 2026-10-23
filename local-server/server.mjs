// JayAng Studio Web 本機伺服器（Node.js 18 以上，不需要安裝任何套件）
// 用法：node server.mjs [port]　預設 http://127.0.0.1:8080
// 所有回應都加上 Cache-Control: no-store，關閉後瀏覽器不會留下快取。
import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec } from 'node:child_process'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const port = Number(process.argv[2] || process.env.PORT || 8080)
const host = '127.0.0.1'
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pfb': 'application/octet-stream',
  '.bcmap': 'application/octet-stream',
  '.gz': 'application/gzip',
  '.txt': 'text/plain; charset=utf-8',
}
// 原始碼、伺服器本身與版本控制資料夾不對外提供（以正規化後的相對路徑判斷，大小寫不分）
const blocked = /^(source|local-server|\.git|\.github)([\\/]|$)/i

const server = createServer((req, res) => {
  let path
  try {
    path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end('400')
    return
  }
  if (path.endsWith('/')) path += 'index.html'
  let file = normalize(join(root, path))
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end()
    return
  }
  if (blocked.test(relative(root, file))) file = join(root, 'index.html')
  let st
  try {
    st = statSync(file)
    if (st.isDirectory()) throw new Error('dir')
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end('404')
    return
  }
  res.writeHead(200, {
    'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  createReadStream(file).pipe(res)
})

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`連接埠 ${port} 已被使用，可改用：node server.mjs 8081`)
  else console.error(e)
  process.exit(1)
})
server.listen(port, host, () => {
  const url = `http://${host}:${port}/`
  console.log(`\n  JayAng Studio Web 已啟動：${url}\n  關閉這個視窗（或按 Ctrl+C）即可停止伺服器。\n`)
  const open = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`
  if (!process.env.NO_OPEN) exec(open, () => {})
})
