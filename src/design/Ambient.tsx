import { useEffect, useState } from 'react'
import { modules, type ModuleId } from '@/config/modules'

/** 噪點（SVG feTurbulence），避免色帶 */
const NOISE = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .6 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>',
)}")`

/**
 * 背景氛圍：2 到 3 顆大型模糊色塊用 transform 緩慢漂移（60 到 90 秒一圈）。
 * 首頁用多個模組色，模組頁用該模組色（--m-1／--m-2）。分頁隱藏時暫停。
 */
export function Ambient({ module }: { module?: ModuleId }) {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    const on = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  const play = hidden ? 'paused' : 'running'
  const home = !module
  const c = (i: number) => (home ? [modules[0].m1, modules[2].m1, modules[3].m1][i] : undefined)
  const blobs = [
    {
      color: c(0) ?? 'var(--m-1)',
      cls: 'left-[-12vw] top-[-18vh] size-[58vw] max-w-[820px] max-h-[820px]',
      anim: 'drift-a 78s',
    },
    {
      color: c(1) ?? 'var(--m-2)',
      cls: 'right-[-16vw] top-[10vh] size-[50vw] max-w-[720px] max-h-[720px]',
      anim: 'drift-b 64s',
    },
    {
      color: c(2) ?? 'var(--m-1)',
      cls: 'left-[25vw] bottom-[-30vh] size-[46vw] max-w-[680px] max-h-[680px]',
      anim: 'drift-c 90s',
    },
  ]
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-bg">
      {blobs.map((b, i) => (
        <div
          key={i}
          className={`motion-decor absolute rounded-full ${b.cls}`}
          style={{
            background: `radial-gradient(closest-side, color-mix(in srgb, ${b.color} 100%, transparent), transparent)`,
            opacity: 'var(--ambient-opacity)',
            filter: 'blur(40px)',
            animation: `${b.anim} linear infinite`,
            animationPlayState: play,
            transition: 'background var(--dur-accent) var(--ease-standard)',
            willChange: 'transform',
          }}
        />
      ))}
      <div
        className="absolute inset-0"
        style={{ backgroundImage: NOISE, opacity: 0.03, mixBlendMode: 'overlay' }}
      />
    </div>
  )
}
