// 用 Playwright（Chromium）把 Logo SVG 轉成 apple-touch-icon 與 PWA 圖示 PNG
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const svg = readFileSync(join(root, 'public/favicon.svg'), 'utf8')
  .replace(/<style>[\s\S]*?<\/style>/, '')
  .replace('class="bg"', 'fill="#ffffff"')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage()
for (const [name, size, pad] of [
  ['apple-touch-icon.png', 180, 0.14],
  ['icon-192.png', 192, 0.16],
  ['icon-512.png', 512, 0.18],
]) {
  await page.setViewportSize({ width: size, height: size })
  const inner = svg.replace('<rect fill="#ffffff" x="0" y="0" width="64" height="64" rx="14"/>', '')
  await page.setContent(`<html><body style="margin:0;background:#fff;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${size * (1 - pad * 2)}px;height:${size * (1 - pad * 2)}px">${inner.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`)
  await page.screenshot({ path: join(root, 'public', name), omitBackground: false })
  console.log('產生', name)
}
await browser.close()
