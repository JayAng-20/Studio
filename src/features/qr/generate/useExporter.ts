import { useCallback, useState } from 'react'
import { toast } from '@/components/ui'
import { useRecents } from '@/stores/recents'
import { useSettings } from '@/stores/settings'
import { copyBlob, downloadBlob } from '@/lib/download'
import { sanitizeFilename } from '@/lib/filename'
import { useT } from '@/i18n'
import { contentSlug, type ContentType } from '../lib/content'
import type { Geometry } from '../lib/geometry'
import { exportBlob, type ExportFormat } from '../lib/render'
import { useQrStore } from '../store'
import { useLogoImage } from './useQr'

/** 匯出檔名：qr_類型_摘要.ext */
export function exportName(ext: string) {
  const s = useQrStore.getState()
  const slug = sanitizeFilename(contentSlug(s.type, s.values[s.type]), '')
  return sanitizeFilename(`qr_${s.type}${slug ? `_${slug}` : ''}`) + `.${ext}`
}

/** 匯出（下載 PNG／SVG／JPG、複製）：完整預覽卡與手機精簡列共用 */
export function useExporter(geo: Geometry | null) {
  const t = useT()
  const style = useQrStore((s) => s.style)
  const quality = useSettings((s) => s.imageQuality)
  const logo = useLogoImage(style)
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const logoReady = !style.logo || !!logo

  const doExport = useCallback(
    async (format: ExportFormat) => {
      if (!geo) return
      setBusy(format)
      try {
        const blob = await exportBlob(geo, style, format, { quality, logo })
        const name = exportName(format)
        downloadBlob(blob, name)
        useRecents.getState().visit('qr', name)
      } catch (e) {
        console.error(e)
        toast.error(t('qr.export.failed'), { description: t('qr.export.failedDesc') })
      } finally {
        setBusy(null)
      }
    },
    [geo, style, quality, logo, t],
  )

  const copy = useCallback(async () => {
    if (!geo) return false
    try {
      const blob = await exportBlob(geo, style, 'png', { logo, size: Math.min(style.size, 1024) })
      return await copyBlob(blob)
    } catch (e) {
      console.error(e)
      return false
    }
  }, [geo, style, logo])

  const pngFile = useCallback(async () => {
    if (!geo) return null
    return exportBlob(geo, style, 'png', { logo })
  }, [geo, style, logo])

  return { style, logo, busy, logoReady, doExport, copy, pngFile }
}

/** 漣漪動畫觸發：第一次出現（從空白到有內容）與換內容類型時播放一次 */
export function useRipple(hasGeo: boolean, displayType: ContentType) {
  const [appear, setAppear] = useState(0)
  const [had, setHad] = useState(false)
  if (hasGeo !== had) {
    setHad(hasGeo)
    if (hasGeo) setAppear((a) => a + 1)
  }
  const trigger = `${displayType}-${appear}`
  const [played, setPlayed] = useState<string | null>(null)
  const ripple = hasGeo && played !== trigger
  const onRippleEnd = useCallback(() => setPlayed(trigger), [trigger])
  return { ripple, onRippleEnd }
}
