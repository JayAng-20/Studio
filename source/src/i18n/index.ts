import { useCallback } from 'react'
import { zhDict, enDict, type Dict } from './dictionaries'
import type { Paths } from './types'
import { useSettings, type Lang } from '@/stores/settings'

export type { Lang } from '@/stores/settings'
export type TKey = Paths<Dict>
export type TVars = Record<string, string | number>

const dicts: Record<Lang, Dict> = { 'zh-TW': zhDict as Dict, en: enDict }

function lookup(dict: Dict, key: string): string | undefined {
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in node)
      node = (node as Record<string, unknown>)[part]
    else return undefined
  }
  return typeof node === 'string' ? node : undefined
}

/** 只替換有提供的變數，其他 {xxx} 原樣保留 */
export function interpolate(str: string, vars?: TVars): string {
  if (!vars) return str
  return str.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

export function translate(lang: Lang, key: TKey, vars?: TVars): string {
  const s = lookup(dicts[lang], key) ?? lookup(dicts['zh-TW'], key)
  if (s === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] 缺少字串：${key}`)
    return key
  }
  return interpolate(s, vars)
}

/** 非 React 環境（store、lib）使用 */
export function t(key: TKey, vars?: TVars): string {
  return translate(useSettings.getState().lang, key, vars)
}

export function useT() {
  const lang = useSettings((s) => s.lang)
  return useCallback((key: TKey, vars?: TVars) => translate(lang, key, vars), [lang])
}

export function useLang() {
  return useSettings((s) => s.lang)
}

export { dicts }
