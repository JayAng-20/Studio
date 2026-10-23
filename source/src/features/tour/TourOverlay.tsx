/**
 * 新手導覽圖層：
 * - 聚光燈：SVG 遮罩挖出目標區域，步驟之間以彈簧動畫平滑移動、變形；
 * - 目標外框：呼吸光暈；
 * - 說明卡：依目標位置自動放在下方、上方或側邊（手機固定在底部），內容依前進方向滑動切換；
 * - 開場：編號計數動畫＋圖示彈入；結束：彩帶綻放。
 * 目標還沒出現（模組載入中）時最多等 2 秒；找不到就以置中卡片說明。
 */
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, ArrowRight, Check, Lightbulb, Sparkles, X } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatedNumber, Button, IconTile } from '@/components/ui'
import { moduleById } from '@/config/modules'
import { Logo } from '@/design/Logo'
import { spring } from '@/design/motion'
import { useMedia } from '@/lib/useMedia'
import { cn } from '@/lib/cn'
import { useSettings } from '@/stores/settings'
import { useLang, useT } from '@/i18n'
import { toolById, toolName } from '@/features/pdf/tools'
import { tourNumber } from './content'
import { useTour } from './store'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const PAD = 8
const HOLE_SPRING = { type: 'spring', stiffness: 260, damping: 36 } as const

const visible = (el: Element) => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
}

/** 追蹤目標元素的位置（捲動、版面變動都會跟上） */
function useTargetRect(selector: string | undefined, smooth: boolean): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null)
  useEffect(() => {
    let raf = 0
    let alive = true
    let el: Element | null = null
    let last = ''
    const t0 = performance.now()
    const tick = () => {
      if (!alive) return
      if (!selector) {
        setRect(null)
        return
      }
      if (!el || !el.isConnected) {
        el = [...document.querySelectorAll(selector)].find(visible) ?? null
        if (el) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' })
        else if (performance.now() - t0 > 2000) {
          setRect(null)
          return
        }
      }
      if (el) {
        const r = el.getBoundingClientRect()
        const key = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`
        if (key !== last) {
          last = key
          setRect({ x: r.x, y: r.y, w: r.width, h: r.height })
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [selector, smooth])
  return selector ? rect : null
}

function useViewport() {
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return vp
}

export default function TourOverlay() {
  const t = useT()
  const lang = useLang()
  const tour = useTour((s) => s.active)
  const step = useTour((s) => s.step)
  const dir = useTour((s) => s.dir)
  const go = useTour((s) => s.go)
  const stop = useTour((s) => s.stop)
  const nav = useNavigate()
  const motionPref = useSettings((s) => s.motion)
  const reduced = useReducedMotion() || motionPref !== 'full'
  // 動畫關閉時，聚光燈、外框與說明卡的位置（非 transform 屬性）也直接跳到定位
  const off = motionPref === 'off'
  const move = off ? { duration: 0 } : spring.smooth
  const mobile = !useMedia('(min-width: 640px)')
  const vp = useViewport()
  const card = useRef<HTMLDivElement>(null)
  const [cardH, setCardH] = useState(280)
  const titleId = useId()

  const text = tour?.text[lang] ?? tour?.text['zh-TW']
  const n = text?.steps.length ?? 0
  const isIntro = step === 0
  const isOutro = step === n + 1
  const selector = tour && !isIntro && !isOutro ? tour.targets[step - 1] : undefined
  const rect = useTargetRect(selector, !reduced)

  useLayoutEffect(() => {
    const el = card.current
    if (!el) return
    const ro = new ResizeObserver(() => setCardH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [tour])

  // 鍵盤：← → 切換、Esc 結束；開啟時把焦點移到卡片
  useEffect(() => {
    if (!tour) return
    card.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        stop()
      } else if (e.key === 'ArrowRight' || (e.key === 'Enter' && e.target === card.current)) {
        e.preventDefault()
        go(useTour.getState().step + 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(useTour.getState().step - 1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [tour, go, stop])

  const hole = rect
    ? { x: rect.x - PAD, y: rect.y - PAD, w: rect.w + PAD * 2, h: rect.h + PAD * 2 }
    : // 收合時保留極小的正值：彈簧收斂到 0 時浮點誤差會產生 -1e-14 這類負值，SVG 會報錯
      { x: vp.w / 2, y: vp.h / 2, w: 0.01, h: 0.01 }

  // 說明卡位置
  const cardW = Math.min(380, vp.w - 32)
  const pos = useMemo(() => {
    if (mobile) return { x: 16, y: vp.h - cardH - 16 }
    if (!rect) return { x: (vp.w - cardW) / 2, y: Math.max(16, (vp.h - cardH) / 2) }
    const gap = 18
    const cx = Math.min(Math.max(16, rect.x + rect.w / 2 - cardW / 2), vp.w - cardW - 16)
    if (rect.y + rect.h + gap + cardH < vp.h - 16) return { x: cx, y: rect.y + rect.h + gap }
    if (rect.y - gap - cardH > 16) return { x: cx, y: rect.y - gap - cardH }
    const cy = Math.min(Math.max(16, rect.y + rect.h / 2 - cardH / 2), vp.h - cardH - 16)
    if (rect.x + rect.w + gap + cardW < vp.w - 16) return { x: rect.x + rect.w + gap, y: cy }
    if (rect.x - gap - cardW > 16) return { x: rect.x - gap - cardW, y: cy }
    return { x: (vp.w - cardW) / 2, y: vp.h - cardH - 16 }
  }, [rect, vp, cardH, cardW, mobile])

  if (!tour || !text) return null
  const num = tourNumber(tour.id)
  const name =
    text.name ?? (tour.tool ? t(toolName(tour.tool)) : tour.module ? t(moduleById[tour.module].nameKey) : '')
  const ToolIcon = tour.tool ? toolById[tour.tool].icon : null
  const total = n + 2
  const slide = reduced ? 0 : 28

  return (
    <div className="fixed inset-0 z-[95]" data-tour-overlay>
      {/* 遮罩與聚光燈 */}
      <svg className="absolute inset-0 size-full" aria-hidden>
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            <motion.rect
              fill="black"
              initial={false}
              animate={{ x: hole.x, y: hole.y, width: hole.w, height: hole.h, rx: rect ? 14 : 0 }}
              // 過阻尼：收合時不會衝過頭變成負值
              transition={off ? { duration: 0 } : HOLE_SPRING}
            />
          </mask>
        </defs>
        <motion.rect
          width="100%"
          height="100%"
          fill="rgba(6,8,12,0.62)"
          mask="url(#tour-mask)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35 }}
        />
      </svg>

      {/* 目標外框光暈 */}
      <AnimatePresence>
        {rect && (
          <motion.div
            key="ring"
            className="pointer-events-none absolute rounded-[14px] ring-2 ring-[var(--accent)]"
            initial={{ opacity: 0, scale: 1.08 }}
            animate={{
              opacity: 1,
              scale: 1,
              left: hole.x,
              top: hole.y,
              width: hole.w,
              height: hole.h,
            }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={move}
          >
            {!reduced && (
              <motion.span
                className="absolute inset-0 rounded-[inherit] ring-4 ring-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
                animate={{ opacity: [0.9, 0, 0.9], scale: [1, 1.035, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 說明卡 */}
      <motion.div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-state="open"
        tabIndex={-1}
        className="absolute left-0 top-0 overflow-hidden rounded-2xl border border-border bg-surface text-text shadow-e4 outline-none"
        style={{ width: mobile ? vp.w - 32 : cardW }}
        initial={{ opacity: 0, x: pos.x, y: pos.y + 24, scale: 0.94 }}
        animate={{ opacity: 1, x: pos.x, y: pos.y, scale: 1 }}
        transition={move}
      >
        {/* 進度條 */}
        <div className="h-1 bg-surface-3">
          <motion.div
            className="h-full bg-gradient-to-r from-[var(--m-1)] to-[var(--m-2)]"
            initial={false}
            animate={{ width: `${((step + 1) / total) * 100}%` }}
            transition={move}
          />
        </div>
        <div className="p-5">
          <div className="mb-3 flex items-center gap-3">
            <motion.div
              key={`icon-${tour.id}`}
              initial={reduced ? false : { scale: 0.4, rotate: -25, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={spring.bouncy}
              className="shrink-0"
            >
              {tour.module ? (
                ToolIcon ? (
                  <span className="grid size-11 place-items-center rounded-[12px] bg-gradient-to-br from-[var(--m-1)] to-[var(--m-2)] text-white shadow-e2">
                    <ToolIcon size={22} aria-hidden />
                  </span>
                ) : (
                  <IconTile module={tour.module} size="md" />
                )
              ) : (
                <Logo size={44} animate />
              )}
            </motion.div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-[.08em] text-accent-ink">
                {t('tour.label')} · <span className="tabular-nums">{String(num).padStart(2, '0')}</span>
              </p>
              <p className="truncate text-body font-semibold">{name}</p>
            </div>
            <Button icon size="sm" variant="ghost" aria-label={t('tour.skip')} onClick={stop}>
              <X size={16} aria-hidden />
            </Button>
          </div>

          <div className="relative min-h-[96px]">
            <AnimatePresence mode="popLayout" initial={false} custom={dir}>
              <motion.div
                key={step}
                custom={dir}
                initial={{ opacity: 0, x: dir * slide, filter: reduced ? 'none' : 'blur(4px)' }}
                animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, x: -dir * slide, filter: reduced ? 'none' : 'blur(4px)' }}
                transition={spring.smooth}
              >
                {isIntro ? (
                  <div className="flex items-start gap-4">
                    <motion.span
                      className="bg-gradient-to-br from-[var(--m-1)] to-[var(--m-2)] bg-clip-text text-[52px] font-bold leading-none tabular-nums text-transparent"
                      initial={reduced ? false : { scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ ...spring.bouncy, delay: 0.08 }}
                    >
                      <AnimatedNumber value={num} format={(v) => String(Math.round(v)).padStart(2, '0')} />
                    </motion.span>
                    <div>
                      <h2 id={titleId} className="text-h3 font-semibold">
                        {name}
                      </h2>
                      <p className="mt-1 text-body text-text-2">{text.intro}</p>
                    </div>
                  </div>
                ) : isOutro ? (
                  <div className="relative">
                    {!reduced && <Burst />}
                    <h2 id={titleId} className="flex items-center gap-2 text-h3 font-semibold">
                      <motion.span
                        initial={{ scale: 0, rotate: -90 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={spring.bouncy}
                        className="grid size-7 place-items-center rounded-full bg-success text-white"
                      >
                        <Check size={16} aria-hidden />
                      </motion.span>
                      {t('tour.doneTitle')}
                    </h2>
                    <div className="mt-3 rounded-lg bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] p-3">
                      <p className="flex items-center gap-1.5 text-caption font-semibold text-accent-ink">
                        <Sparkles size={13} aria-hidden /> {t('tour.effect')}
                      </p>
                      <p className="mt-1 text-body">{text.effect}</p>
                    </div>
                    {text.tip && (
                      <p className="mt-2 flex gap-1.5 text-small text-text-2">
                        <Lightbulb size={15} className="mt-0.5 shrink-0 text-warning-ink" aria-hidden />
                        {text.tip}
                      </p>
                    )}
                    <p className="mt-2 text-caption text-text-3">{t('tour.doneDesc')}</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-caption font-medium tabular-nums text-text-3">
                      {t('tour.step', { current: step, total: n })}
                    </p>
                    <h2 id={titleId} className="mt-0.5 text-h3 font-semibold">
                      {text.steps[step - 1].title}
                    </h2>
                    <p className="mt-1 text-body text-text-2">{text.steps[step - 1].body}</p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <LayoutGroup id="tour-dots">
              <div className="flex flex-1 items-center gap-1.5" aria-hidden>
                {Array.from({ length: total }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    tabIndex={-1}
                    onClick={() => go(i)}
                    className="relative h-1.5 w-1.5 rounded-full bg-border-strong"
                  >
                    {i === step && (
                      <motion.span
                        layoutId="tour-dot"
                        className="absolute -inset-y-0 -left-1 -right-1 rounded-full bg-[var(--accent)]"
                        transition={spring.snappy}
                      />
                    )}
                  </button>
                ))}
              </div>
            </LayoutGroup>
            {step > 0 && (
              <Button size="sm" variant="ghost" leading={<ArrowLeft size={15} aria-hidden />} onClick={() => go(step - 1)}>
                {t('tour.prev')}
              </Button>
            )}
            {isOutro ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    stop()
                    nav('/settings')
                  }}
                >
                  {t('tour.backToList')}
                </Button>
                <Button size="sm" variant="primary" leading={<Check size={15} aria-hidden />} onClick={stop}>
                  {t('tour.finish')}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="primary" trailing={<ArrowRight size={15} aria-hidden />} onClick={() => go(step + 1)}>
                {t('tour.next')}
              </Button>
            )}
          </div>
          <p className="mt-2 hidden text-[11px] text-text-3 sm:block">{t('tour.keys')}</p>
        </div>
      </motion.div>
    </div>
  )
}

/** 完成時的彩帶綻放 */
function Burst() {
  const colors = ['var(--m-1)', 'var(--m-2)', '#22c55e', '#f97316', '#d946ef', '#facc15']
  const parts = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => {
        const a = (i / 22) * Math.PI * 2 + (i % 3) * 0.3
        const d = 70 + ((i * 37) % 60)
        return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.7 - 20, r: (i * 47) % 360, c: colors[i % colors.length], s: 5 + (i % 3) * 2 }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  return (
    <div className="pointer-events-none absolute left-4 top-3" aria-hidden>
      {parts.map((p, i) => (
        <motion.span
          key={i}
          className={cn('absolute rounded-[2px]', i % 2 ? 'rounded-full' : '')}
          style={{ width: p.s, height: p.s * (i % 2 ? 1 : 1.8), background: p.c }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.4 }}
          animate={{ x: p.x, y: [0, p.y, p.y + 40], opacity: [1, 1, 0], rotate: p.r, scale: 1 }}
          transition={{ duration: 1.3, ease: [0.16, 1, 0.3, 1], times: [0, 0.55, 1] }}
        />
      ))}
    </div>
  )
}

