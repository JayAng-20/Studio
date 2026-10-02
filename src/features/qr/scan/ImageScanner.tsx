import { AnimatePresence, motion } from 'motion/react'
import { ImageOff, SearchX } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AddFilesButton,
  Callout,
  DropTarget,
  DropZone,
  FileName,
  usePasteFiles,
} from '@/components/ui'
import { EmptyIllustration } from '@/design/illustrations'
import { decodeImage } from '@/lib/image'
import { UrlPool } from '@/lib/files'
import { useRecents } from '@/stores/recents'
import { duration, sec, spring } from '@/design/motion'
import { useT } from '@/i18n'
import { QrDecoder, type Detection } from '../lib/decode'
import { mapCorners, ScanOverlay, useSize } from './ScanOverlay'

type State = 'scanning' | 'found' | 'none' | 'error'

const ACCEPT = 'image/*,.heic,.heif'

/** HEIC 在多數瀏覽器無法直接解碼：失敗時改用 heic-to（使用時才載入） */
async function decodeAny(file: File): Promise<ImageBitmap> {
  try {
    return await decodeImage(file)
  } catch (e) {
    if (!/hei[cf]/i.test(file.type) && !/\.(heic|heif)$/i.test(file.name)) throw e
    const { heicTo } = await import('heic-to')
    return heicTo({ blob: file, type: 'bitmap' })
  }
}

export interface IncomingImage {
  file: File
  nonce: number
}

export function ImageScanner({
  incoming,
  onDetect,
  onStatus,
  onEngine,
}: {
  incoming: IncomingImage | null
  onDetect: (d: Detection[]) => void
  onStatus: (s: 'idle' | 'scanning' | 'found') => void
  onEngine: (e: 'native' | 'jsqr' | null) => void
}) {
  const t = useT()
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<State>('scanning')
  const [found, setFound] = useState<{ list: Detection[]; w: number; h: number } | null>(null)
  const [boxRef, box] = useSize<HTMLDivElement>()
  const pool = useRef(new UrlPool())
  const seq = useRef(0)
  const decoderRef = useRef<QrDecoder | null>(null)
  const props = useRef({ onDetect, onStatus, onEngine })
  useEffect(() => {
    props.current = { onDetect, onStatus, onEngine }
  })

  const run = useCallback(async (f: File) => {
    const my = ++seq.current
    pool.current.revokeAll()
    setFile(f)
    setUrl(pool.current.create(f))
    setFound(null)
    setState('scanning')
    props.current.onStatus('scanning')
    useRecents.getState().visit('qr', f.name)
    let bmp: ImageBitmap | null = null
    try {
      bmp = await decodeAny(f)
      if (my !== seq.current) return
      decoderRef.current ??= await QrDecoder.create()
      props.current.onEngine(decoderRef.current.engine)
      // 讓掃描線至少跑一小段，辨識太快時畫面不會只閃一下
      const [list] = await Promise.all([
        decoderRef.current.detectImage(bmp, bmp.width, bmp.height),
        new Promise((r) => setTimeout(r, duration.slow)),
      ])
      if (my !== seq.current) return
      if (list.length) {
        setFound({ list, w: bmp.width, h: bmp.height })
        setState('found')
        props.current.onStatus('found')
        props.current.onDetect(list)
      } else {
        setState('none')
        props.current.onStatus('idle')
      }
    } catch (e) {
      console.error(e)
      if (my !== seq.current) return
      setState('error')
      props.current.onStatus('idle')
    } finally {
      bmp?.close()
    }
  }, [])

  // 其他模組或首頁傳來的圖片
  useEffect(() => {
    if (!incoming) return
    const id = setTimeout(() => void run(incoming.file))
    return () => clearTimeout(id)
  }, [incoming, run])

  useEffect(() => {
    const p = pool.current
    const s = seq
    return () => {
      s.current++
      p.revokeAll()
      decoderRef.current?.dispose()
      decoderRef.current = null
    }
  }, [])

  const intake = useCallback((files: File[]) => files[0] && void run(files[0]), [run])
  usePasteFiles(intake, !!file)

  if (!file || !url) {
    return (
      <DropZone
        onFiles={intake}
        accept={ACCEPT}
        multiple={false}
        title={t('qr.image.dropTitle')}
        formats={t('qr.image.formats')}
        illustration={<EmptyIllustration module="qr" />}
      />
    )
  }

  const target =
    found && found.list[0]
      ? mapCorners(found.list[0].corners, { w: found.w, h: found.h }, box, 'contain')
      : null

  return (
    <DropTarget onFiles={intake} accept={ACCEPT} multiple={false} className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-small font-medium text-text-2">
          <FileName name={file.name} />
        </span>
        <AddFilesButton
          onFiles={intake}
          accept={ACCEPT}
          multiple={false}
          label={t('qr.image.another')}
          size="sm"
        />
      </div>
      <AnimatePresence initial={false}>
        {(state === 'none' || state === 'error') && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={spring.smooth}
          >
            <Callout
              tone="warning"
              icon={
                state === 'none' ? (
                  <SearchX size={16} aria-hidden />
                ) : (
                  <ImageOff size={16} aria-hidden />
                )
              }
              title={state === 'none' ? t('qr.image.notFoundTitle') : t('qr.image.decodeFailed')}
            >
              {state === 'none' ? t('qr.image.notFoundDesc') : t('qr.image.decodeFailedDesc')}
            </Callout>
          </motion.div>
        )}
        {state === 'found' && found && found.list.length > 1 && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: sec(duration.base) }}
            className="text-small text-text-2"
          >
            {t('qr.image.foundCount', { count: found.list.length })}
          </motion.p>
        )}
      </AnimatePresence>
      <div
        ref={boxRef}
        className="relative aspect-[4/3] max-h-[min(62vh,560px)] w-full overflow-hidden rounded-2xl bg-surface-2 shadow-e1"
      >
        <img
          src={url}
          alt={t('qr.image.preview', { name: file.name })}
          className="absolute inset-0 size-full object-contain"
        />
        {(state === 'scanning' || state === 'found') && (
          <ScanOverlay
            box={box}
            target={target}
            state={state === 'scanning' ? 'scanning' : 'success'}
          />
        )}
        <p className="sr-only" role="status" aria-live="polite">
          {state === 'scanning'
            ? t('qr.image.scanning')
            : state === 'found'
              ? t('qr.image.foundCount', { count: found?.list.length ?? 0 })
              : ''}
        </p>
      </div>
    </DropTarget>
  )
}
