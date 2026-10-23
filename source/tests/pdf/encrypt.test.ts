import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hash2B } from '@/features/pdf/lib/encrypt'

/** 參考實作：依 qpdf 的 hash_V5（輪數從 1 起算，第 64 輪起檢查最後一個位元組） */
function reference(pw: Buffer, salt: Buffer, udata: Buffer): Buffer {
  let K = createHash('sha256')
    .update(Buffer.concat([pw, salt, udata]))
    .digest()
  for (let round = 1; ; round++) {
    const K1 = Buffer.concat(Array(64).fill(Buffer.concat([pw, K, udata])))
    const c = createCipheriv('aes-128-cbc', K.subarray(0, 16), K.subarray(16, 32))
    c.setAutoPadding(false)
    const E = Buffer.concat([c.update(K1), c.final()])
    let sum = 0
    for (let j = 0; j < 16; j++) sum += E[j]
    K = createHash(['sha256', 'sha384', 'sha512'][sum % 3])
      .update(E)
      .digest()
    if (round >= 64 && E[E.length - 1] <= round - 32) break
  }
  return K.subarray(0, 32)
}

describe('AES-256（R6）密碼雜湊', () => {
  it('演算法 2.B 與參考實作一致（含終止輪數的邊界）', async () => {
    for (let i = 0; i < 400; i++) {
      const pw = randomBytes(i % 12)
      const salt = randomBytes(8)
      const udata = i % 2 ? randomBytes(48) : Buffer.alloc(0)
      const got = await hash2B(new Uint8Array(pw), new Uint8Array(salt), new Uint8Array(udata))
      expect(Buffer.from(got).toString('hex')).toBe(reference(pw, salt, udata).toString('hex'))
    }
  }, 60_000)
})
