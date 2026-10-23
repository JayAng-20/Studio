import { useSyncExternalStore } from 'react'

/** 訂閱 media query */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(query)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => matchMedia(query).matches,
    () => false,
  )
}

export const useIsDesktop = () => useMedia('(min-width: 1024px)')
export const useIsMobile = () => useMedia('(max-width: 639px)')
export const useCanHover = () => useMedia('(hover: hover)')
