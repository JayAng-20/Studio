import { useCallback, useEffect, useRef, useState } from 'react'
import { LARGE_FILE_BYTES, filesFromClipboard, matchesAccept } from '@/lib/files'
import { formatBytes } from '@/lib/format'
import { t } from '@/i18n'
import { toast } from './Toast'

export interface IntakeOptions {
  accept?: string
  multiple?: boolean
  onFiles: (files: File[]) => void
}

/** 最近一次放下檔案的位置（讓新檔案卡從游標處飛入） */
export const dropOrigin = { x: 0, y: 0, t: 0 }

/**
 * 檔案輸入共用邏輯：過濾格式、單檔超過 200 MB 先警告。
 * 回傳 intake(files) 與大檔確認狀態（由 DropZone 或呼叫端顯示對話框）。
 */
export function useFileIntake({ accept, multiple = true, onFiles }: IntakeOptions) {
  const cb = useRef(onFiles)
  useEffect(() => {
    cb.current = onFiles
  })
  const [pendingLarge, setPendingLarge] = useState<File[] | null>(null)

  const intake = useCallback(
    (raw: File[]) => {
      let files = raw.filter((f) => matchesAccept(f, accept))
      const rejected = raw.filter((f) => !matchesAccept(f, accept))
      if (rejected.length) {
        toast.error(t('errors.unsupportedFile'), {
          description: t('errors.unsupportedFileDesc', { name: rejected[0].name }),
        })
      }
      if (!multiple) files = files.slice(0, 1)
      if (!files.length) return
      if (files.some((f) => f.size > LARGE_FILE_BYTES)) {
        setPendingLarge(files)
        return
      }
      cb.current(files)
    },
    [accept, multiple],
  )

  const confirmLarge = useCallback(() => {
    if (pendingLarge) cb.current(pendingLarge)
    setPendingLarge(null)
  }, [pendingLarge])

  const largeSize = pendingLarge ? formatBytes(Math.max(...pendingLarge.map((f) => f.size))) : ''

  return { intake, pendingLarge, confirmLarge, cancelLarge: () => setPendingLarge(null), largeSize }
}

/** 頁面層級的貼上（⌘/Ctrl+V）：焦點在輸入框時不攔截 */
export function usePasteFiles(onFiles: (files: File[]) => void, enabled = true) {
  const cb = useRef(onFiles)
  useEffect(() => {
    cb.current = onFiles
  })
  useEffect(() => {
    if (!enabled) return
    const handler = (e: ClipboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
        return
      const files = filesFromClipboard(e)
      if (files.length) {
        e.preventDefault()
        cb.current(files)
      }
    }
    window.addEventListener('paste', handler)
    return () => window.removeEventListener('paste', handler)
  }, [enabled])
}
