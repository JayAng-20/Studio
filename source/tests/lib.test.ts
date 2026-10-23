// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { formatBytes, formatTime, percentChange } from '@/lib/format'
import {
  applyTemplate,
  createDeduper,
  dedupeNames,
  outputName,
  sanitizeFilename,
  splitExt,
} from '@/lib/filename'
import { createZip, readZip } from '@/lib/zip'
import { fileKind, matchesAccept } from '@/lib/files'
import { useFileBus } from '@/stores/fileBus'
import { recentModules } from '@/stores/recents'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [1048576, '1 MB'],
    [5.25 * 1024 * 1024, '5.3 MB'],
    [150 * 1024 * 1024, '150 MB'],
    [3 * 1024 ** 3, '3 GB'],
  ])('%d → %s', (n, s) => expect(formatBytes(n)).toBe(s))
  it('無效值', () => expect(formatBytes(-1)).toBe('—'))
})

describe('formatTime', () => {
  it('基本', () => {
    expect(formatTime(0)).toBe('00:00')
    expect(formatTime(65)).toBe('01:05')
    expect(formatTime(3725)).toBe('1:02:05')
    expect(formatTime(12.44, { tenths: true })).toBe('00:12.4')
    expect(formatTime(59.99, { tenths: true })).toBe('00:59.9')
    expect(formatTime(5, { forceHours: true })).toBe('0:00:05')
    expect(formatTime(NaN)).toBe('00:00')
  })
  it('百分比變化', () => {
    expect(percentChange(200, 50)).toBe(-75)
    expect(percentChange(0, 50)).toBe(0)
  })
})

describe('檔名', () => {
  it('淨化', () => {
    expect(sanitizeFilename('a/b\\c:d*?.png')).toBe('a_b_c_d__.png')
    expect(sanitizeFilename('  ..secret  ')).toBe('secret')
    expect(sanitizeFilename('CON')).toBe('file')
    expect(sanitizeFilename('')).toBe('file')
  })
  it('拆副檔名', () => {
    expect(splitExt('photo.JPG')).toEqual({ base: 'photo', ext: 'jpg' })
    expect(splitExt('.env')).toEqual({ base: '.env', ext: '' })
    expect(splitExt('a.tar.gz')).toEqual({ base: 'a.tar', ext: 'gz' })
  })
  it('去重加流水號', () => {
    expect(dedupeNames(['a.png', 'a.png', 'A.png', 'b', 'b'])).toEqual([
      'a.png',
      'a (2).png',
      'A (3).png',
      'b',
      'b (2)',
    ])
    const d = createDeduper(['x.jpg', 'x (2).jpg'])
    expect(d('x.jpg')).toBe('x (3).jpg')
    expect(d('x (2).jpg')).toBe('x (4).jpg')
  })
  it('命名模板', () => {
    expect(applyTemplate('{name}_{w}x{h}', { name: 'photo', w: 800, h: 600 }, 'webp')).toBe(
      'photo_800x600.webp',
    )
    expect(applyTemplate('{name}_{action}', { name: 'photo' }, 'png')).toBe('photo.png')
    expect(outputName('IMG 1.HEIC', 'converted', 'jpg')).toBe('IMG 1_converted.jpg')
    expect(applyTemplate('{index}-{name}', { name: 'a', index: 3 })).toBe('3-a')
  })
})

describe('檔案類型', () => {
  it('fileKind', () => {
    expect(fileKind({ name: 'a.heic', type: '' })).toBe('image')
    expect(fileKind({ name: 'a.pdf', type: '' })).toBe('pdf')
    expect(fileKind({ name: 'a.mkv', type: '' })).toBe('video')
    expect(fileKind({ name: 'a.flac', type: 'audio/flac' })).toBe('audio')
    expect(fileKind({ name: 'a.srt', type: '' })).toBe('subtitle')
  })
  it('matchesAccept', () => {
    expect(matchesAccept({ name: 'a.png', type: 'image/png' }, 'image/*')).toBe(true)
    expect(matchesAccept({ name: 'a.heic', type: '' }, 'image/*,.heic')).toBe(true)
    expect(matchesAccept({ name: 'a.pdf', type: 'application/pdf' }, 'image/*')).toBe(false)
  })
})

describe('fflate ZIP 來回', () => {
  it('壓縮後解壓內容相同，同名自動去重', async () => {
    const enc = new TextEncoder()
    const blob = await createZip([
      { name: 'a.txt', data: enc.encode('你好') },
      { name: 'a.txt', data: new Blob(['world']) },
      { name: 'p.png', data: new Uint8Array([1, 2, 3]) },
    ])
    expect(blob.type).toBe('application/zip')
    const out = await readZip(new Uint8Array(await blob.arrayBuffer()))
    expect(Object.keys(out).sort()).toEqual(['a (2).txt', 'a.txt', 'p.png'])
    expect(new TextDecoder().decode(out['a.txt'])).toBe('你好')
    expect(new TextDecoder().decode(out['a (2).txt'])).toBe('world')
    expect(Array.from(out['p.png'])).toEqual([1, 2, 3])
  })
})

describe('FileBus', () => {
  it('send／peek／take', () => {
    const f = new File(['x'], 'a.webm', { type: 'video/webm' })
    useFileBus.getState().send('gif', 'recorder', [f], { range: { start: 1, end: 2 } })
    expect(useFileBus.getState().peek('gif')?.files[0].name).toBe('a.webm')
    const p = useFileBus.getState().take('gif')
    expect(p?.from).toBe('recorder')
    expect(p?.meta?.range).toEqual({ start: 1, end: 2 })
    expect(useFileBus.getState().take('gif')).toBeUndefined()
  })
  it('不同目標互不干擾', () => {
    const f = new File(['x'], 'a.png')
    useFileBus.getState().send('tools', 'convert', [f])
    expect(useFileBus.getState().peek('convert')).toBeUndefined()
    useFileBus.getState().clear()
    expect(useFileBus.getState().peek('tools')).toBeUndefined()
  })
})

describe('最近使用', () => {
  it('recentModules 不重複並依時間', () => {
    expect(
      recentModules([
        { module: 'qr', at: 3 },
        { module: 'pdf', at: 2 },
        { module: 'qr', at: 1 },
        { module: 'gif', at: 0 },
        { module: 'player', at: 0 },
      ]),
    ).toEqual(['qr', 'pdf', 'gif'])
  })
})
