// 從 package.json 的執行期依賴產生第三方授權清單：THIRD_PARTY.md 與 src/config/thirdParty.json
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const rows = Object.keys(pkg.dependencies)
  .sort()
  .map((name) => {
    const p = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'))
    const license = typeof p.license === 'string' ? p.license : p.license?.type || 'UNKNOWN'
    const repo =
      typeof p.repository === 'string' ? p.repository : p.repository?.url || p.homepage || ''
    return {
      name,
      version: p.version,
      license,
      url: repo.replace(/^git\+/, '').replace(/\.git$/, ''),
    }
  })

writeFileSync(join(root, 'src/config/thirdParty.json'), JSON.stringify(rows, null, 2) + '\n')
const md = [
  '# 第三方授權',
  '',
  '本專案在執行期使用以下開放原始碼套件（由 `scripts/gen-third-party.mjs` 自動產生）。',
  '',
  '| 套件 | 版本 | 授權 |',
  '|---|---|---|',
  ...rows.map(
    (r) => `| ${r.url ? `[${r.name}](${r.url})` : r.name} | ${r.version} | ${r.license} |`,
  ),
  '',
].join('\n')
writeFileSync(join(root, 'THIRD_PARTY.md'), md)
console.log(`已產生 ${rows.length} 筆第三方授權`)
