import { AnimatePresence, motion } from 'motion/react'
import {
  Camera,
  CameraOff,
  Flashlight,
  FlashlightOff,
  ImageIcon,
  Pause,
  Play,
  RotateCcw,
  SwitchCamera,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Tooltip } from '@/components/ui'
import { caps } from '@/lib/capabilities'
import { cn } from '@/lib/cn'
import { duration, sec, spring } from '@/design/motion'
import { useT } from '@/i18n'
import { QrDecoder, type Detection } from '../lib/decode'
import { mapCorners, ScanOverlay, useSize, type Rect } from './ScanOverlay'

type Phase = 'idle' | 'starting' | 'live' | 'error'
export type CameraError = 'denied' | 'notFound' | 'busy' | 'insecure' | 'unsupported' | 'generic'

/** getUserMedia 的例外 → 給使用者看的錯誤類型 */
export function cameraErrorKind(e: unknown): CameraError {
  const name = (e as { name?: string })?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError')
    return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError')
    return 'notFound'
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy'
  return 'generic'
}

interface TorchCaps {
  torch?: boolean
}

/** 相同內容在這段時間內不重複回報（連續掃描） */
const DEDUPE_MS = 2500
/** 解碼間隔：在流暢與耗電之間取平衡 */
const FRAME_GAP = duration.instant
/** 連續掃描時，成功提示停留的時間 */
const FLASH_HOLD = duration.hero

export function CameraScanner({
  continuous,
  onDetect,
  onUseImage,
  onStatus,
  onEngine,
}: {
  continuous: boolean
  onDetect: (d: Detection[]) => void
  onUseImage: () => void
  onStatus: (s: 'idle' | 'live' | 'found') => void
  onEngine: (e: 'native' | 'jsqr' | null) => void
}) {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [boxRef, box] = useSize<HTMLDivElement>()
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<CameraError | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torch, setTorch] = useState(false)
  const [paused, setPaused] = useState(false)
  const [hit, setHit] = useState<{ corners: Detection['corners']; src: { w: number; h: number } } | null>(
    null,
  )

  const streamRef = useRef<MediaStream | null>(null)
  const decoderRef = useRef<QrDecoder | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const activeRef = useRef(false)
  const pausedRef = useRef(false)
  const lastRef = useRef<{ text: string; at: number } | null>(null)
  /** 按「繼續掃描」後忽略的內容：直到畫面中不再出現它為止 */
  const suppressRef = useRef<string | null>(null)
  const missRef = useRef(0)
  const startSeq = useRef(0)
  const mounted = useRef(true)
  const resumeOnVisible = useRef(false)
  const props = useRef({ continuous, onDetect, onStatus })
  useEffect(() => {
    props.current = { continuous, onDetect, onStatus }
  })

  /** 停止相機：停止所有 track、清掉解碼器與計時器 */
  const release = useCallback(() => {
    activeRef.current = false
    startSeq.current++
    clearTimeout(timerRef.current)
    clearTimeout(flashTimer.current)
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
    const v = videoRef.current
    if (v) v.srcObject = null
    decoderRef.current?.dispose()
    decoderRef.current = null
  }, [])

  const stop = useCallback(() => {
    release()
    setPhase('idle')
    setPaused(false)
    pausedRef.current = false
    setTorch(false)
    setHit(null)
    onEngine(null)
    props.current.onStatus('idle')
  }, [release, onEngine])

  const handle = useCallback((found: Detection[], src: { w: number; h: number }) => {
    const first = found[0]
    if (suppressRef.current === first.text) return
    suppressRef.current = null
    const now = performance.now()
    const last = lastRef.current
    if (props.current.continuous && last && last.text === first.text && now - last.at < DEDUPE_MS) {
      lastRef.current = { text: first.text, at: now }
      return
    }
    lastRef.current = { text: first.text, at: now }
    setHit({ corners: first.corners, src })
    try {
      navigator.vibrate?.(30)
    } catch {
      /* 不支援震動 */
    }
    props.current.onDetect(found)
    if (props.current.continuous) {
      clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setHit(null), FLASH_HOLD)
    } else {
      // 單次模式：定格畫面，讓括號與 QR 對齊
      pausedRef.current = true
      setPaused(true)
      videoRef.current?.pause()
      props.current.onStatus('found')
    }
  }, [])

  // 迴圈透過 ref 呼叫自己（避免 useCallback 自我參照）
  const loopRef = useRef<() => Promise<void>>(async () => {})
  const loop = useCallback(async () => {
    if (!activeRef.current) return
    const v = videoRef.current
    const dec = decoderRef.current
    if (v && dec && v.readyState >= 2 && !pausedRef.current && !document.hidden && v.videoWidth) {
      const src = { w: v.videoWidth, h: v.videoHeight }
      const found = await dec.detectFrame(v, src.w, src.h)
      // 連續幾個畫面都沒有 QR，才算「已移開」
      if (!found.length) {
        if (++missRef.current >= 4) suppressRef.current = null
      } else missRef.current = 0
      if (found.length && activeRef.current && !pausedRef.current) handle(found, src)
    }
    if (activeRef.current) timerRef.current = setTimeout(() => void loopRef.current(), FRAME_GAP)
  }, [handle])
  useEffect(() => {
    loopRef.current = loop
  }, [loop])

  const start = useCallback(
    async (wantDevice?: string) => {
      release()
      const seq = ++startSeq.current
      setError(null)
      setHit(null)
      setPaused(false)
      pausedRef.current = false
      setTorch(false)
      if (!window.isSecureContext) {
        setError('insecure')
        setPhase('error')
        return
      }
      if (!caps.userMedia()) {
        setError('unsupported')
        setPhase('error')
        return
      }
      setPhase('starting')
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: wantDevice
            ? { deviceId: { exact: wantDevice }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        })
      } catch (e) {
        const kind = cameraErrorKind(e)
        // 使用者拒絕或沒有相機屬於預期情況，不算程式錯誤
        if (kind === 'denied' || kind === 'notFound') console.warn(e)
        else console.error(e)
        if (!mounted.current || seq !== startSeq.current) return
        setError(kind)
        setPhase('error')
        props.current.onStatus('idle')
        return
      }
      // 使用者在授權期間離開或重新開始：立即釋放
      if (!mounted.current || seq !== startSeq.current) {
        stream.getTracks().forEach((tr) => tr.stop())
        return
      }
      streamRef.current = stream
      const v = videoRef.current
      if (v) {
        v.srcObject = stream
        try {
          await v.play()
        } catch (e) {
          // 自動播放被擋時，元件仍可在使用者互動後播放
          console.error(e)
        }
      }
      const track = stream.getVideoTracks()[0]
      const settings = track?.getSettings?.() ?? {}
      setDeviceId(settings.deviceId ?? wantDevice ?? null)
      const trackCaps = (track?.getCapabilities?.() ?? {}) as TorchCaps
      setTorchSupported(!!trackCaps.torch)
      try {
        const all = await navigator.mediaDevices.enumerateDevices()
        if (mounted.current) setDevices(all.filter((d) => d.kind === 'videoinput'))
      } catch (e) {
        console.error(e)
      }
      const dec = await QrDecoder.create()
      if (!mounted.current || seq !== startSeq.current) {
        dec.dispose()
        return
      }
      decoderRef.current = dec
      onEngine(dec.engine)
      activeRef.current = true
      setPhase('live')
      props.current.onStatus('live')
      void loop()
    },
    [release, loop, onEngine],
  )

  const resume = useCallback(() => {
    setHit(null)
    pausedRef.current = false
    setPaused(false)
    suppressRef.current = lastRef.current?.text ?? null
    lastRef.current = null
    void videoRef.current?.play().catch((e: unknown) => console.error(e))
    props.current.onStatus('live')
  }, [])

  const pause = useCallback(() => {
    pausedRef.current = true
    setPaused(true)
    videoRef.current?.pause()
  }, [])

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as unknown as MediaTrackConstraintSet] })
      setTorch(!torch)
    } catch (e) {
      console.error(e)
      setTorchSupported(false)
    }
  }

  const switchCamera = () => {
    if (devices.length < 2) return
    const i = devices.findIndex((d) => d.deviceId === deviceId)
    const next = devices[(i + 1) % devices.length]
    void start(next.deviceId)
  }

  // 卸載時一定釋放相機
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      release()
    }
  }, [release])

  // 分頁隱藏時關掉相機（省電、讓出相機），回來後自動重新開啟
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        if (activeRef.current) {
          resumeOnVisible.current = true
          release()
        }
      } else if (resumeOnVisible.current) {
        resumeOnVisible.current = false
        void start(deviceId ?? undefined)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [release, start, deviceId])

  // 空白鍵：暫停／繼續
  useEffect(() => {
    if (phase !== 'live') return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON' || el.isContentEditable))
        return
      e.preventDefault()
      if (pausedRef.current) resume()
      else pause()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, pause, resume])

  // 從連續切回單次時清掉殘留的成功提示
  useEffect(() => {
    if (!continuous) clearTimeout(flashTimer.current)
  }, [continuous])

  const target: Rect | null = hit ? mapCorners(hit.corners, hit.src, box, 'cover') : null
  const live = phase === 'live'

  return (
    <div
      ref={boxRef}
      className="relative aspect-[3/4] max-h-[min(72vh,620px)] w-full overflow-hidden rounded-2xl bg-surface-3 shadow-e2 sm:aspect-[4/3]"
    >
      <video
        ref={videoRef}
        muted
        playsInline
        aria-label={t('qr.camera.viewfinder')}
        className={cn(
          'absolute inset-0 size-full object-cover transition-opacity duration-(--dur-base)',
          live ? 'opacity-100' : 'opacity-0',
        )}
      />
      {live && (
        <ScanOverlay
          box={box}
          target={target}
          state={hit ? 'success' : paused ? 'idle' : 'scanning'}
          vignette
        />
      )}

      <AnimatePresence mode="wait" initial={false}>
        {phase === 'idle' && (
          <Centered key="idle">
            <span className="mb-4 grid size-16 place-items-center rounded-2xl bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent-ink">
              <Camera size={30} aria-hidden />
            </span>
            <h3 className="text-h3 font-semibold text-text">{t('qr.camera.idleTitle')}</h3>
            <p className="mt-1.5 max-w-sm text-body text-text-2">{t('qr.camera.idleDesc')}</p>
            <Button
              variant="primary"
              size="lg"
              className="mt-5"
              leading={<Camera size={18} aria-hidden />}
              onClick={() => void start()}
            >
              {t('qr.camera.start')}
            </Button>
          </Centered>
        )}
        {phase === 'starting' && (
          <Centered key="starting">
            <span className="mb-3 grid size-12 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent-ink">
              <Camera size={24} aria-hidden className="qr-pulse motion-decor" />
            </span>
            <p className="text-body font-medium text-text" role="status">
              {t('qr.camera.starting')}
            </p>
          </Centered>
        )}
        {phase === 'error' && error && (
          <Centered key="error" role="alert">
            <span className="mb-4 grid size-14 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-danger-ink">
              <CameraOff size={26} aria-hidden />
            </span>
            <h3 className="text-h3 font-semibold text-text">{t(`qr.camera.${error}Title`)}</h3>
            <p className="mt-1.5 max-w-md text-body text-text-2">{t(`qr.camera.${error}Desc`)}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {error !== 'insecure' && error !== 'unsupported' && (
                <Button variant="primary" leading={<RotateCcw size={16} aria-hidden />} onClick={() => void start()}>
                  {t('common.retry')}
                </Button>
              )}
              <Button variant="secondary" leading={<ImageIcon size={16} aria-hidden />} onClick={onUseImage}>
                {t('qr.camera.useImage')}
              </Button>
            </div>
          </Centered>
        )}
      </AnimatePresence>

      {live && (
        <>
          <div className="absolute left-3 top-3">
            <span
              className="glass inline-flex h-8 items-center gap-2 rounded-full px-3 text-caption font-medium text-text"
              role="status"
              aria-live="polite"
            >
              <span
                className={cn(
                  'size-2 rounded-full',
                  hit ? 'bg-success' : 'bg-danger qr-pulse motion-decor',
                )}
              />
              {hit ? t('qr.camera.found') : paused ? t('qr.camera.pause') : t('qr.camera.aim')}
            </span>
          </div>
          <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-2 px-3">
            {devices.length > 1 && (
              <GlassButton label={t('qr.camera.switch')} onClick={switchCamera}>
                <SwitchCamera size={20} aria-hidden />
              </GlassButton>
            )}
            {torchSupported && (
              <GlassButton
                label={torch ? t('qr.camera.torchOff') : t('qr.camera.torchOn')}
                onClick={() => void toggleTorch()}
                pressed={torch}
              >
                {torch ? <FlashlightOff size={20} aria-hidden /> : <Flashlight size={20} aria-hidden />}
              </GlassButton>
            )}
            <AnimatePresence initial={false} mode="popLayout">
              {paused ? (
                <motion.div
                  key="resume"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={spring.snappy}
                >
                  <Button variant="primary" size="lg" leading={<Play size={18} aria-hidden />} onClick={resume}>
                    {t('qr.camera.resume')}
                  </Button>
                </motion.div>
              ) : (
                <motion.div
                  key="pause"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={spring.snappy}
                >
                  <GlassButton label={t('qr.camera.pause')} onClick={pause}>
                    <Pause size={20} aria-hidden />
                  </GlassButton>
                </motion.div>
              )}
            </AnimatePresence>
            <GlassButton label={t('qr.camera.stop')} onClick={stop}>
              <CameraOff size={20} aria-hidden />
            </GlassButton>
          </div>
        </>
      )}
    </div>
  )
}

function Centered({ children, role }: { children: ReactNode; role?: string }) {
  return (
    <motion.div
      role={role}
      className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: sec(duration.base) }}
    >
      {children}
    </motion.div>
  )
}

function GlassButton({
  label,
  onClick,
  children,
  pressed,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  pressed?: boolean
}) {
  return (
    <Tooltip content={label}>
      <motion.button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
        whileTap={{ scale: 0.92 }}
        transition={spring.snappy}
        className={cn(
          'glass grid size-12 place-items-center rounded-full text-text shadow-e2',
          pressed && 'bg-[color-mix(in_srgb,var(--warning)_30%,var(--surface))]',
        )}
      >
        {children}
      </motion.button>
    </Tooltip>
  )
}
