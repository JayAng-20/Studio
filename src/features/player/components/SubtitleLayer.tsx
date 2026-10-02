import { useMemo } from 'react'
import { cn } from '@/lib/cn'
import { usePlayer, useCurrent } from '../store'
import { activeCues, cueToLines } from '../logic/subtitles'

/**
 * 自繪字幕層（比原生 <track> 更好控制）：延遲、大小、位置、背景；
 * 控制列出現時自動往上讓位。文字以 React 文字節點渲染，不使用 innerHTML。
 */
export function SubtitleLayer() {
  const item = useCurrent()
  const time = usePlayer((s) => s.time)
  const on = usePlayer((s) => s.subsOn)
  const delay = usePlayer((s) => s.subDelay)
  const style = usePlayer((s) => s.subStyle)
  const controls = usePlayer((s) => s.controlsVisible)
  const track = item?.subtitles.find((s) => s.id === item.activeSub)
  const cues = useMemo(() => (track && on ? activeCues(track.cues, time, delay) : []), [track, on, time, delay])
  if (!cues.length) return null
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 z-[5] flex flex-col items-center px-[5%] text-center transition-transform duration-(--dur-slow) ease-standard',
        style.bg === 'shadow' && 'sub-shadow',
        style.bg === 'box' && 'sub-box',
      )}
      style={
        {
          bottom: `${style.position}%`,
          '--sub-scale': style.size,
          transform: controls ? 'translateY(calc(-1 * var(--controls-h) + 12px))' : 'translateY(0)',
        } as React.CSSProperties
      }
      aria-live="off"
    >
      {cues.map((c, ci) => (
        <div key={`${c.start}-${ci}`} className="flex flex-col items-center">
          {cueToLines(c.text).map((line, li) => (
            <p key={li} className="sub-line">
              <span className="sub-text">
                {line.map((seg, si) => (
                  <span
                    key={si}
                    className={cn(seg.italic && 'italic', seg.bold && 'font-bold', seg.underline && 'underline')}
                  >
                    {seg.text}
                  </span>
                ))}
              </span>
            </p>
          ))}
        </div>
      ))}
    </div>
  )
}
