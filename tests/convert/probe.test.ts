// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  formatFromName,
  isobmffInfo,
  probeBytes,
  probeFile,
  sniffFormat,
  svgInfo,
} from '@/features/convert/lib/probe'
import {
  ascii,
  buildGif,
  buildHeic,
  buildJpeg,
  buildPng,
  buildTiff,
  buildWebpExtended,
  buildWebpLossless,
} from './fixtures'

const text = (s: string) => new Uint8Array(ascii(s))

describe('格式辨識與尺寸（只讀檔頭）', () => {
  it('依內容辨識', () => {
    expect(sniffFormat(buildJpeg())).toBe('jpeg')
    expect(sniffFormat(buildPng())).toBe('png')
    expect(sniffFormat(buildGif())).toBe('gif')
    expect(sniffFormat(buildWebpLossless(2, 2, false))).toBe('webp')
    expect(sniffFormat(buildHeic())).toBe('heic')
    expect(sniffFormat(buildHeic({ brand: 'avif' }))).toBe('avif')
    expect(
      sniffFormat(
        text('<?xml version="1.0"?>\n<!-- x -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      ),
    ).toBe('svg')
    expect(sniffFormat(new Uint8Array([0x42, 0x4d, 0, 0]))).toBe('bmp')
    expect(sniffFormat(new Uint8Array([0, 0, 1, 0, 1, 0]))).toBe('ico')
    expect(sniffFormat(new Uint8Array([0x49, 0x49, 0x2a, 0]))).toBe('tiff')
    expect(sniffFormat(text('hello world'))).toBe('unknown')
  })

  it('副檔名備援', () => {
    expect(formatFromName('a.HEIF')).toBe('heic')
    expect(formatFromName('b.jfif')).toBe('jpeg')
    expect(formatFromName('c.txt')).toBe('unknown')
  })

  it('JPEG：SOF 尺寸，EXIF 方向 5 到 8 交換寬高', () => {
    expect(probeBytes(buildJpeg({ width: 640, height: 480 }))).toMatchObject({
      format: 'jpeg',
      width: 640,
      height: 480,
    })
    expect(probeBytes(buildJpeg({ width: 640, height: 480, tiff: buildTiff(6) }))).toMatchObject({
      width: 480,
      height: 640,
    })
    expect(probeBytes(buildJpeg({ width: 640, height: 480, tiff: buildTiff(3) }))).toMatchObject({
      width: 640,
      height: 480,
    })
  })

  it('PNG：IHDR、透明、APNG', () => {
    expect(probeBytes(buildPng({ width: 32, height: 16, colorType: 6 }))).toMatchObject({
      format: 'png',
      width: 32,
      height: 16,
      alpha: true,
      animated: false,
    })
    expect(probeBytes(buildPng({ colorType: 2 })).alpha).toBe(false)
    expect(probeBytes(buildPng({ apngFrames: 12 }))).toMatchObject({
      format: 'apng',
      animated: true,
      frames: 12,
    })
  })

  it('GIF：格數與透明', () => {
    expect(probeBytes(buildGif(3))).toMatchObject({
      format: 'gif',
      width: 10,
      height: 8,
      frames: 3,
      animated: true,
      alpha: true,
    })
    expect(probeBytes(buildGif(1))).toMatchObject({ frames: 1, animated: false })
  })

  it('WebP：VP8L、VP8X 動畫', () => {
    expect(probeBytes(buildWebpLossless(300, 200, true))).toMatchObject({
      format: 'webp',
      width: 300,
      height: 200,
      alpha: true,
    })
    expect(probeBytes(buildWebpExtended(640, 360, 0x02 | 0x10, 4))).toMatchObject({
      width: 640,
      height: 360,
      animated: true,
      alpha: true,
      frames: 4,
    })
  })

  it('HEIC／AVIF：取最大的 ispe，irot 90° 交換寬高', () => {
    expect(isobmffInfo(buildHeic())).toEqual({ width: 4032, height: 3024 })
    expect(isobmffInfo(buildHeic({ rotate: true }))).toEqual({ width: 3024, height: 4032 })
    expect(probeBytes(buildHeic({ brand: 'avif', sizes: [[1200, 800]] }))).toMatchObject({
      format: 'avif',
      width: 1200,
      height: 800,
    })
  })

  it('SVG：width／height、只有 viewBox、單邊＋viewBox、百分比忽略', () => {
    expect(svgInfo('<svg width="120" height="80px"></svg>')).toEqual({ width: 120, height: 80 })
    expect(svgInfo('<svg viewBox="0 0 24 24"></svg>')).toEqual({ width: 24, height: 24 })
    expect(svgInfo('<svg width="200" viewBox="0 0 100 50"></svg>')).toEqual({
      width: 200,
      height: 100,
    })
    expect(svgInfo('<svg width="100%" height="100%" viewBox="0,0,640,480"></svg>')).toEqual({
      width: 640,
      height: 480,
    })
    expect(svgInfo('<svg></svg>')).toBeNull()
  })

  it('probeFile 讀取 Blob', async () => {
    const r = await probeFile(
      Object.assign(new Blob([buildGif(2) as Uint8Array<ArrayBuffer>]), { name: 'a.gif' }),
    )
    expect(r).toMatchObject({ format: 'gif', frames: 2, animated: true })
  })
})
