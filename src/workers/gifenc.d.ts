/** gifenc 沒有附型別，這裡只宣告本專案用到的部分 */
declare module 'gifenc' {
  export type GifPalette = number[][]
  export interface WriteFrameOptions {
    palette?: GifPalette | null
    first?: boolean
    transparent?: boolean
    transparentIndex?: number
    delay?: number
    repeat?: number
    colorDepth?: number
    dispose?: number
  }
  export interface GifEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOptions): void
    finish(): void
    bytes(): Uint8Array
    bytesView(): Uint8Array
    reset(): void
    writeHeader(): void
    readonly buffer: ArrayBuffer
    readonly stream: { readonly length?: number; writeByte(b: number): void }
  }
  export function GIFEncoder(opts?: {
    auto?: boolean
    initialCapacity?: number
  }): GifEncoderInstance
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: {
      format?: 'rgb565' | 'rgb444' | 'rgba4444'
      oneBitAlpha?: boolean | number
      clearAlpha?: boolean
      clearAlphaThreshold?: number
      clearAlphaColor?: number
    },
  ): GifPalette
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: 'rgb565' | 'rgb444' | 'rgba4444',
  ): Uint8Array
  const _default: typeof GIFEncoder
  export default _default
}
