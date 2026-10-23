import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isLocalHost } from '@/lib/localMode'

const LOOPBACK_SRC = String.raw`/^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0)$/i`

describe('本機伺服器模式判斷', () => {
  it('只有本機位址算本機模式，正式網域照常安裝 Service Worker', () => {
    for (const h of [
      'localhost',
      '127.0.0.1',
      '127.1.2.3',
      '[::1]',
      '::1',
      '0.0.0.0',
      'app.localhost',
    ])
      expect(isLocalHost(h)).toBe(true)
    for (const h of [
      'jayang.github.io',
      'example.com',
      '192.168.1.10',
      'localhost.example.com',
      '1127.0.0.1',
    ])
      expect(isLocalHost(h)).toBe(false)
  })
  it('index.html 內嵌腳本與 sw-local-guard.js 使用相同的判斷式', () => {
    const root = resolve(__dirname, '..')
    for (const f of ['index.html', 'public/sw-local-guard.js'])
      expect(readFileSync(resolve(root, f), 'utf8')).toContain(LOOPBACK_SRC)
    expect(readFileSync(resolve(root, 'src/lib/localMode.ts'), 'utf8')).toContain(LOOPBACK_SRC)
  })
})
