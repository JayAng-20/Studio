// 修改原始碼後執行：npm run publish:root
// 重新建置，並把結果更新到上一層（網站成品所在的位置）。只會替換網站檔案，不會動到 source 資料夾。
import { execSync } from 'node:child_process'
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const src = resolve(new URL('..', import.meta.url).pathname)
const root = resolve(src, '..')
const dist = join(src, 'dist')
const keep = new Set([
  'source',
  'local-server',
  'README.md',
  '.github',
  '.git',
  '.nojekyll',
  '.gitignore',
])

execSync('npm run build', { cwd: src, stdio: 'inherit' })
if (!existsSync(join(dist, 'index.html'))) throw new Error('建置失敗：找不到 dist/index.html')

for (const name of readdirSync(root)) {
  if (!keep.has(name)) rmSync(join(root, name), { recursive: true, force: true })
}
cpSync(dist, root, { recursive: true })
console.log('已更新網站成品：', root)
