// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** 解析 tokens.css：取得每個選擇器區塊的變數 */
const css = readFileSync('src/design/tokens.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const blocks = new Map<string, Record<string, string>>()
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim()
  const vars: Record<string, string> = {}
  for (const v of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[v[1]] = v[2].trim()
  blocks.set(sel, { ...(blocks.get(sel) || {}), ...vars })
}
const root = blocks.get(':root')!
const dark = { ...root, ...blocks.get(":root[data-theme='dark']") }

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.replace('#', ''), 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}
const lum = (h: string) =>
  hex(h)
    .map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0)
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const MODULES = ['player', 'recorder', 'gif', 'convert', 'tools', 'qr', 'pdf']
const themes = [
  {
    name: 'light',
    base: root,
    mod: (m: string) => ({ ...root, ...blocks.get(`:root[data-module='${m}']`) }),
  },
  {
    name: 'dark',
    base: dark,
    mod: (m: string) => ({
      ...dark,
      ...blocks.get(`:root[data-module='${m}']`),
      ...blocks.get(`:root[data-theme='dark'][data-module='${m}']`),
    }),
  },
]

describe('色彩對比 token', () => {
  for (const th of themes) {
    const t = th.base
    it(`${th.name}：一般文字 ≥ 4.5:1`, () => {
      for (const fg of ['--text', '--text-2', '--text-3']) {
        for (const bg of ['--bg', '--surface', '--surface-2']) {
          expect(ratio(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
        }
      }
      for (const fg of ['--success-ink', '--warning-ink', '--danger-ink']) {
        expect(ratio(t[fg], t['--surface']), `${fg}`).toBeGreaterThanOrEqual(4.5)
      }
    })
    for (const m of [...MODULES, 'default']) {
      it(`${th.name}／${m}：強調文字 ≥ 4.5、主按鈕白字 ≥ 4.5、圖形 ≥ 3`, () => {
        const v = m === 'default' ? t : th.mod(m)
        expect(
          ratio(v['--accent-ink'], v['--surface']),
          'accent-ink/surface',
        ).toBeGreaterThanOrEqual(4.5)
        expect(ratio(v['--accent-ink'], v['--bg']), 'accent-ink/bg').toBeGreaterThanOrEqual(4.5)
        expect(
          ratio(v['--on-accent'] ?? '#ffffff', v['--accent-strong']),
          'on-accent/accent-strong',
        ).toBeGreaterThanOrEqual(4.5)
        expect(ratio(v['--accent'], v['--surface']), 'accent/surface').toBeGreaterThanOrEqual(3)
      })
    }
  }
})
