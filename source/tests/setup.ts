import '@testing-library/jest-dom/vitest'

if (typeof window !== 'undefined') {
  // jsdom 缺少的 API
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  }
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= RO as unknown as typeof ResizeObserver
  // @ts-expect-error 測試環境補上
  globalThis.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  if (!URL.createObjectURL) {
    URL.createObjectURL = () => 'blob:mock'
    URL.revokeObjectURL = () => {}
  }
  Element.prototype.scrollIntoView ??= function () {}
  HTMLElement.prototype.hasPointerCapture ??= () => false
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.setPointerCapture ??= () => {}
}
