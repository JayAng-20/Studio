import { AnimatePresence, motion } from 'motion/react'
import { ScanLine } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, SegmentedControl, Switch } from '@/components/ui'
import { StageContainer } from '@/components/layout/ModulePage'
import { useModuleShortcuts } from '@/stores/ui'
import { caps, modKey } from '@/lib/capabilities'
import { uid } from '@/lib/files'
import { spring, staggerDelay } from '@/design/motion'
import { useT } from '@/i18n'
import type { Detection } from '../lib/decode'
import { parseScan, scanSummary } from '../lib/parse'
import {
  addHistory,
  loadHistory,
  saveHistory,
  type HistoryItem,
  type ScanSource,
} from '../lib/storage'
import { useQrStore } from '../store'
import { CameraScanner } from './CameraScanner'
import { History } from './History'
import { ImageScanner, type IncomingImage } from './ImageScanner'
import { KIND_ICONS } from './kindIcons'
import { ResultCard, type ResultEntry } from './ResultCard'

export function Scanner({ incoming }: { incoming: IncomingImage | null }) {
  const t = useT()
  const [source, setSource] = useState<ScanSource>(() =>
    incoming || !caps.userMedia() ? 'image' : 'camera',
  )
  // 收到其他模組傳來的圖片：切到「圖片」
  const [seenIncoming, setSeenIncoming] = useState(incoming?.nonce ?? null)
  if (incoming && incoming.nonce !== seenIncoming) {
    setSeenIncoming(incoming.nonce)
    setSource('image')
  }
  const [continuous, setContinuous] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>(() => loadHistory())
  const historyRef = useRef(history)
  useEffect(() => {
    historyRef.current = history
  }, [history])
  const [current, setCurrent] = useState<ResultEntry[]>([])
  const [session, setSession] = useState<ResultEntry[]>([])
  const [engine, setEngine] = useState<'native' | 'jsqr' | null>(null)
  const setScanStatus = useQrStore((s) => s.setScanStatus)
  const resultRef = useRef<HTMLDivElement>(null)

  useModuleShortcuts([
    { keys: ['Space'], label: t('qr.shortcuts.pause') },
    { keys: [modKey(), 'V'], label: t('qr.shortcuts.paste') },
  ])

  useEffect(() => () => setScanStatus('idle'), [setScanStatus])

  const onDetect = useCallback(
    (list: Detection[], src: ScanSource) => {
      const at = Date.now()
      const entries: ResultEntry[] = list.map((d) => ({
        id: uid('scan'),
        result: parseScan(d.text),
        source: src,
        at,
      }))
      setCurrent(entries)
      let h = historyRef.current
      for (let i = list.length - 1; i >= 0; i--) h = addHistory(h, list[i].text, src)
      historyRef.current = h
      setHistory(h)
      if (src === 'camera' && continuous) setSession((s) => [...entries, ...s].slice(0, 30))
      // 手機版結果在相機下方：捲到可見處
      if (
        !continuous &&
        typeof matchMedia === 'function' &&
        !matchMedia('(min-width: 1024px)').matches
      ) {
        requestAnimationFrame(() =>
          resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        )
      }
    },
    [continuous],
  )

  const showHistory = (h: HistoryItem) =>
    setCurrent([{ id: h.id, result: parseScan(h.text), source: h.source, at: h.at }])

  const onCameraStatus = useCallback(
    (s: 'idle' | 'live' | 'found') =>
      setScanStatus(
        s === 'live' ? (continuous ? 'continuous' : 'camera') : s === 'found' ? 'found' : 'idle',
      ),
    [continuous, setScanStatus],
  )
  const onImageStatus = useCallback(
    (s: 'idle' | 'scanning' | 'found') => {
      // 開始辨識新圖片時清掉上一張的結果，避免誤會
      if (s === 'scanning') setCurrent([])
      setScanStatus(s === 'scanning' ? 'image' : s === 'found' ? 'found' : 'idle')
    },
    [setScanStatus],
  )
  const changeSource = (s: ScanSource) => {
    setSource(s)
    setEngine(null)
    setScanStatus('idle')
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_var(--panel-w)] lg:gap-6">
      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl<ScanSource>
            label={t('qr.scan.sourceLabel')}
            value={source}
            onChange={changeSource}
            options={[
              { value: 'camera', label: t('qr.scan.camera') },
              { value: 'image', label: t('qr.scan.image') },
            ]}
          />
          {source === 'camera' && (
            <Switch
              checked={continuous}
              onChange={(c) => {
                setContinuous(c)
                setSession([])
              }}
              label={t('qr.camera.continuous')}
              className="min-w-[200px] sm:min-w-0 sm:gap-3"
            />
          )}
        </div>
        <StageContainer stage={source}>
          {source === 'camera' ? (
            <CameraScanner
              continuous={continuous}
              onDetect={(d) => onDetect(d, 'camera')}
              onUseImage={() => changeSource('image')}
              onStatus={onCameraStatus}
              onEngine={setEngine}
            />
          ) : (
            <ImageScanner
              incoming={incoming}
              onDetect={(d) => onDetect(d, 'image')}
              onStatus={onImageStatus}
              onEngine={setEngine}
            />
          )}
        </StageContainer>
        {engine && (
          <p className="text-caption text-text-3">
            {engine === 'native' ? t('qr.scan.engineNative') : t('qr.scan.engineJs')}
          </p>
        )}
      </section>

      <aside className="flex min-w-0 scroll-mt-20 flex-col gap-4 lg:sticky lg:top-[calc(var(--topbar-h)+16px)]">
        <div ref={resultRef} className="flex scroll-mt-20 flex-col gap-4" aria-live="polite">
          <AnimatePresence mode="popLayout" initial={false}>
            {current.length ? (
              current.map((e) => <ResultCard key={e.id} entry={e} />)
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="card flex flex-col items-center px-5 py-8 text-center"
              >
                <span className="mb-3 grid size-12 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-accent-ink">
                  <ScanLine size={24} aria-hidden />
                </span>
                <p className="text-body font-semibold">{t('qr.result.empty')}</p>
                <p className="mt-1 text-small text-text-3">{t('qr.result.emptyDesc')}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {continuous && session.length > 0 && (
          <section className="card flex flex-col gap-2 p-4" aria-labelledby="qr-session-title">
            <div className="flex items-center justify-between">
              <h2 id="qr-session-title" className="text-h3 font-semibold">
                {t('qr.camera.sessionTitle')}
              </h2>
              <Badge tone="accent" className="tabular-nums">
                {t('qr.camera.sessionCount', { count: session.length })}
              </Badge>
            </div>
            <ul className="-mx-1 flex max-h-64 flex-col overflow-y-auto">
              <AnimatePresence initial={false}>
                {session.map((e, i) => {
                  const Icon = KIND_ICONS[e.result.kind]
                  return (
                    <motion.li
                      key={e.id}
                      layout
                      initial={{ opacity: 0, x: -8 }}
                      animate={{
                        opacity: 1,
                        x: 0,
                        transition: { ...spring.smooth, delay: staggerDelay(Math.min(i, 1)) },
                      }}
                      transition={spring.smooth}
                    >
                      <button
                        type="button"
                        onClick={() => setCurrent([e])}
                        className="flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left hover:bg-surface-2"
                      >
                        <Icon size={15} className="shrink-0 text-text-3" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-small">
                          {scanSummary(e.result)}
                        </span>
                      </button>
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ul>
          </section>
        )}

        <History
          items={history}
          activeText={current[0]?.result.raw ?? null}
          onShow={showHistory}
          onRemove={(id) => {
            const next = history.filter((h) => h.id !== id)
            historyRef.current = next
            setHistory(next)
            saveHistory(next)
          }}
          onClear={() => {
            historyRef.current = []
            setHistory([])
            saveHistory([])
          }}
        />
      </aside>
    </div>
  )
}
