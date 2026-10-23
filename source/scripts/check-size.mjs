// build 後檢查首頁 JS（gzip）大小。使用者決定「品質優先、不設硬上限」，
// 因此超過預算只輸出警告；設定 STRICT_SIZE=1 時才讓 CI 失敗。
import { readFileSync, readdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const BUDGET_KB = 150
const dist = new URL('../dist/', import.meta.url).pathname
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const entries = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+\.js)"/g)].map((m) => m[1])
let total = 0
for (const f of entries) {
  const kb = gzipSync(readFileSync(join(dist, f))).length / 1024
  total += kb
  console.log(`${kb.toFixed(1).padStart(8)} KB  ${f}`)
}
const lazy = readdirSync(join(dist, 'assets')).filter(
  (f) => f.endsWith('.js') && !entries.includes(`assets/${f}`),
).length
console.log(
  `首頁 JS（gzip）合計 ${total.toFixed(1)} KB；預算 ${BUDGET_KB} KB；另有 ${lazy} 個懶載入 chunk`,
)
if (total > BUDGET_KB) {
  console.warn(`⚠ 首頁 JS 超過預算 ${(total - BUDGET_KB).toFixed(1)} KB`)
  if (process.env.STRICT_SIZE === '1') process.exit(1)
}
