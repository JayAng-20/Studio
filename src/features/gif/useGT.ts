import { useCallback } from 'react'
import { useT, type TKey, type TVars } from '@/i18n'
import type { Paths } from '@/i18n/types'
import type { zh } from './i18n'

export type GifKey = Paths<typeof zh>

/** 模組字串：自動加上 gif. 前綴 */
export function useGT() {
  const t = useT()
  return useCallback((key: GifKey, vars?: TVars) => t(`gif.${key}` as TKey, vars), [t])
}
