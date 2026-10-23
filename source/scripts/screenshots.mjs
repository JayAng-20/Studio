// 視覺驗證：啟動 preview 後，把首頁、設定與七個模組頁，各以「淺／深」×「1440、768、390 寬」截圖到 docs/screenshots/
// 用法：npm run build && node scripts/screenshots.mjs [路由篩選] [--out=目錄]
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const args = process.argv.slice(2)
const filter = args.find((a) => !a.startsWith('--'))
const outArg = args.find((a) => a.startsWith('--out='))
const out = outArg ? outArg.slice(6) : join(root, 'docs/screenshots')
const widthsArg = args.find((a) => a.startsWith('--widths='))
const themesArg = args.find((a) => a.startsWith('--themes='))
mkdirSync(out, { recursive: true })

const routes = [
  ['home', '/'],
  ['settings', '/settings'],
  ['player', '/player'],
  ['recorder', '/recorder'],
  ['gif', '/gif'],
  ['convert', '/convert'],
  ['tools', '/tools'],
  ['qr', '/qr'],
  ['pdf', '/pdf'],
].filter(([n]) => !filter || filter.split(',').includes(n))
const widths = widthsArg ? widthsArg.slice(9).split(',').map(Number) : [1440, 768, 390]
const themes = themesArg ? themesArg.slice(9).split(',') : ['light', 'dark']
const PORT = 4179

const server = spawn(
  process.execPath,
  [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'],
  { cwd: root, stdio: 'pipe' },
)
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && res())
  server.on('exit', rej)
  setTimeout(res, 6000)
})

const browser = await chromium.launch()
const errors = []
try {
  for (const theme of themes) {
    for (const w of widths) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: w < 640 ? 844 : w < 1024 ? 1024 : 900 },
        deviceScaleFactor: 1,
        colorScheme: theme,
        reducedMotion: 'no-preference',
      })
      await ctx.addInitScript((th) => {
        localStorage.setItem(
          'jayang:settings',
          JSON.stringify({ state: { theme: th, motion: 'off', lang: 'zh-TW' }, version: 1 }),
        )
      }, theme)
      const page = await ctx.newPage()
      page.on('console', (m) => m.type() === 'error' && errors.push(`${m.text()}`))
      page.on('pageerror', (e) => errors.push(String(e)))
      for (const [name, path] of routes) {
        await page.goto(`http://localhost:${PORT}/#${path}`)
        await page.waitForTimeout(1200)
        await page.screenshot({ path: join(out, `${name}-${theme}-${w}.png`), fullPage: false })
      }
      await ctx.close()
    }
  }
} finally {
  await browser.close()
  server.kill()
}
if (errors.length) {
  console.log('主控台錯誤：')
  ;[...new Set(errors)].forEach((e) => console.log(' -', e))
}
console.log('完成：', out)
