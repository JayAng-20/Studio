// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { decodeText, decodeWith } from '@/features/player/logic/encoding'

const utf8 = (s: string) => new TextEncoder().encode(s)

describe('decodeText', () => {
  it('UTF-8（無 BOM）', () => {
    const r = decodeText(utf8('你好，世界'))
    expect(r).toEqual({ text: '你好，世界', encoding: 'utf-8', fallback: false })
  })
  it('UTF-8 BOM 會被移除', () => {
    const r = decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('字幕')]))
    expect(r.text).toBe('字幕')
    expect(r.encoding).toBe('utf-8')
  })
  it('UTF-16 LE／BE BOM', () => {
    const le = new Uint8Array([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59]) // 你好
    const be = new Uint8Array([0xfe, 0xff, 0x4f, 0x60, 0x59, 0x7d])
    expect(decodeText(le)).toMatchObject({ text: '你好', encoding: 'utf-16le' })
    expect(decodeText(be)).toMatchObject({ text: '你好', encoding: 'utf-16be' })
  })
  it('UTF-8 失敗時退回 Big5', () => {
    // 「你好」的 Big5：A7 41 A6 6E；加上時間行確認 ASCII 不受影響
    const bytes = new Uint8Array([...utf8('00:01 '), 0xa7, 0x41, 0xa6, 0x6e])
    const r = decodeText(bytes)
    expect(r.encoding).toBe('big5')
    expect(r.fallback).toBe(true)
    expect(r.text).toBe('00:01 你好')
  })
  it('純 ASCII 視為 UTF-8', () => {
    expect(decodeText(utf8('WEBVTT')).encoding).toBe('utf-8')
  })
  it('空檔案', () => expect(decodeText(new Uint8Array()).text).toBe(''))
})

describe('decodeWith', () => {
  it('手動指定編碼', () => {
    expect(decodeWith(new Uint8Array([0xa7, 0x41]), 'big5')).toBe('你')
  })
})
