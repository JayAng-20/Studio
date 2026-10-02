/** 能力偵測（不看瀏覽器名稱） */

const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : {}
const nav =
  typeof navigator !== 'undefined' ? (navigator as unknown as Record<string, unknown>) : {}

export const caps = {
  displayMedia: () =>
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function',
  userMedia: () =>
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function',
  mediaRecorder: () => typeof w.MediaRecorder === 'function',
  recorderType: (mime: string) =>
    typeof MediaRecorder !== 'undefined' &&
    typeof MediaRecorder.isTypeSupported === 'function' &&
    MediaRecorder.isTypeSupported(mime),
  barcodeDetector: () => typeof w.BarcodeDetector === 'function',
  eyeDropper: () => typeof w.EyeDropper === 'function',
  documentPip: () => 'documentPictureInPicture' in w,
  videoPip: () =>
    typeof document !== 'undefined' &&
    'pictureInPictureEnabled' in document &&
    !!document.pictureInPictureEnabled,
  offscreenCanvas: () => typeof w.OffscreenCanvas === 'function',
  webCodecs: () => typeof w.VideoEncoder === 'function' && typeof w.VideoDecoder === 'function',
  saveFilePicker: () => typeof w.showSaveFilePicker === 'function',
  clipboardWrite: () => typeof w.ClipboardItem === 'function' && !!navigator.clipboard?.write,
  audioTracks: () =>
    typeof HTMLMediaElement !== 'undefined' && 'audioTracks' in HTMLMediaElement.prototype,
  viewTransitions: () => typeof document !== 'undefined' && 'startViewTransition' in document,
  fullscreen: () => typeof document !== 'undefined' && !!document.fullscreenEnabled,
  share: () => typeof nav.share === 'function',
  storageEstimate: () => !!navigator.storage?.estimate,
  touch: () => typeof matchMedia === 'function' && matchMedia('(hover: none)').matches,
  hardwareConcurrency: () => Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)),
}

export const isMac = () =>
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent)

/** 修飾鍵顯示：⌘ 或 Ctrl */
export const modKey = () => (isMac() ? '⌘' : 'Ctrl')
