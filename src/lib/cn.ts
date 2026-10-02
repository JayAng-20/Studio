/** 合併 className（略過假值） */
export function cn(...parts: Array<string | boolean | null | undefined | 0 | 0n>): string {
  return parts.filter(Boolean).join(' ')
}
