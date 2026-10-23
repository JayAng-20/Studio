/** WebAssembly 是否可用（獨立成小檔，避免把編碼器載入程式帶進主 chunk） */
export const wasmSupported = () =>
  typeof WebAssembly === 'object' && typeof WebAssembly.compile === 'function'
