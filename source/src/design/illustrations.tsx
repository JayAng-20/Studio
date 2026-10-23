import type { CSSProperties, ReactNode } from 'react'
import { moduleById, type ModuleId } from '@/config/modules'

/**
 * 每個模組一張自繪空狀態插圖，帶一個很輕的循環動畫（.motion-decor：精簡／關閉時停止）。
 * 顏色取自模組色，背景卡片用 surface token，深淺色皆適用。
 */
export function EmptyIllustration({ module, size = 168 }: { module: ModuleId; size?: number }) {
  const m = moduleById[module]
  const style = { '--i1': m.m1, '--i2': m.m2 } as CSSProperties
  const body: Record<ModuleId, ReactNode> = {
    player: <PlayerArt />,
    recorder: <RecorderArt />,
    gif: <GifArt />,
    convert: <ConvertArt />,
    tools: <ToolsArt />,
    stitch: <StitchArt />,
    qr: <QrArt />,
    pdf: <PdfArt />,
    pdfconvert: <PdfConvertArt />,
    doc2pdf: <Doc2PdfArt />,
  }
  return (
    <svg
      width={size}
      height={(size * 120) / 168}
      viewBox="0 0 168 120"
      fill="none"
      aria-hidden
      style={style}
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={`ill-${module}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--i1)" />
          <stop offset="1" stopColor="var(--i2)" />
        </linearGradient>
      </defs>
      <ellipse cx="84" cy="110" rx="58" ry="6" fill="var(--text)" opacity=".06" />
      <g fill={`url(#ill-${module})`} stroke={`url(#ill-${module})`}>
        {body[module]}
      </g>
    </svg>
  )
}

const card = { fill: 'var(--surface)', stroke: 'var(--border-strong)', strokeWidth: 1.5 }
const floatStyle = (dur: number, delay = 0): CSSProperties => ({
  animation: `float-y ${dur}s ease-in-out ${delay}s infinite`,
  transformBox: 'fill-box',
})

function PlayerArt() {
  return (
    <>
      <rect x="30" y="22" width="108" height="72" rx="14" {...card} />
      <rect x="40" y="32" width="88" height="44" rx="8" fill="var(--surface-2)" stroke="none" />
      <path d="M78 46v16l14-8z" stroke="none" />
      <rect x="40" y="83" width="88" height="3" rx="1.5" fill="var(--surface-3)" stroke="none" />
      <rect x="40" y="83" width="38" height="3" rx="1.5" stroke="none" />
      <g className="motion-decor" style={floatStyle(2.6)}>
        <path
          d="M134 18v18a5 5 0 1 1-3-4.6V22l12-3v14a5 5 0 1 1-3-4.6V15z"
          stroke="none"
          opacity=".9"
        />
      </g>
      <g className="motion-decor" style={floatStyle(3.2, 0.6)}>
        <path d="M22 44v12a4 4 0 1 1-2.4-3.7V44l8-2v3z" stroke="none" opacity=".6" />
      </g>
    </>
  )
}

function RecorderArt() {
  return (
    <>
      <rect x="22" y="18" width="124" height="80" rx="12" {...card} />
      <rect x="22" y="18" width="124" height="14" rx="12" fill="var(--surface-2)" stroke="none" />
      <circle cx="33" cy="25" r="2.5" fill="var(--text-3)" stroke="none" opacity=".5" />
      <circle cx="41" cy="25" r="2.5" fill="var(--text-3)" stroke="none" opacity=".5" />
      <rect x="36" y="44" width="56" height="6" rx="3" fill="var(--surface-3)" stroke="none" />
      <rect x="36" y="56" width="40" height="6" rx="3" fill="var(--surface-3)" stroke="none" />
      <rect x="36" y="68" width="48" height="6" rx="3" fill="var(--surface-3)" stroke="none" />
      <g transform="translate(116 70)">
        <circle r="16" fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="1.5" />
        <circle
          r="7"
          stroke="none"
          className="motion-decor"
          style={{
            animation: 'breathe 1.8s ease-in-out infinite',
            transformBox: 'fill-box',
            transformOrigin: 'center',
          }}
        />
      </g>
    </>
  )
}

function GifArt() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <g key={i} className="motion-decor" style={floatStyle(2.4, i * 0.25)}>
          <rect x={22 + i * 44} y={30 + (i % 2) * 6} width="38" height="52" rx="7" {...card} />
          <rect
            x={27 + i * 44}
            y={36 + (i % 2) * 6}
            width="28"
            height="30"
            rx="4"
            stroke="none"
            opacity={0.35 + i * 0.25}
          />
          <rect
            x={27 + i * 44}
            y={71 + (i % 2) * 6}
            width="18"
            height="4"
            rx="2"
            fill="var(--surface-3)"
            stroke="none"
          />
        </g>
      ))}
      <text
        x="84"
        y="104"
        textAnchor="middle"
        fontSize="11"
        fontWeight="800"
        letterSpacing="2"
        stroke="none"
        fontFamily="Inter Variable, system-ui"
      >
        GIF
      </text>
    </>
  )
}

function ConvertArt() {
  return (
    <>
      <g className="motion-decor" style={floatStyle(3)}>
        <rect x="18" y="26" width="52" height="64" rx="9" {...card} />
        <path d="M26 76l12-14 9 9 6-6 9 11z" stroke="none" opacity=".5" />
        <circle cx="54" cy="42" r="5" stroke="none" opacity=".5" />
      </g>
      <g className="motion-decor" style={floatStyle(3, 0.5)}>
        <rect x="98" y="26" width="52" height="64" rx="9" {...card} />
        <path d="M106 76l12-14 9 9 6-6 9 11z" stroke="none" />
        <circle cx="134" cy="42" r="5" stroke="none" />
      </g>
      <path
        d="M76 52h16m0 0-5-5m5 5-5 5M92 66H76m0 0 5-5m-5 5 5 5"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  )
}

function ToolsArt() {
  return (
    <>
      <rect x="34" y="20" width="100" height="76" rx="10" {...card} />
      <path d="M44 84l22-26 14 14 10-10 20 22z" stroke="none" opacity=".45" />
      <circle cx="108" cy="40" r="7" stroke="none" opacity=".45" />
      <g
        className="motion-decor"
        style={{
          animation: 'breathe 3s ease-in-out infinite',
          transformBox: 'fill-box',
          transformOrigin: 'center',
        }}
      >
        <rect
          x="52"
          y="32"
          width="64"
          height="52"
          rx="2"
          fill="none"
          strokeWidth="2"
          strokeDasharray="5 4"
        />
        {[
          [52, 32],
          [116, 32],
          [52, 84],
          [116, 84],
        ].map(([x, y], i) => (
          <rect
            key={i}
            x={x - 4}
            y={y - 4}
            width="8"
            height="8"
            rx="2"
            fill="var(--surface)"
            strokeWidth="2"
          />
        ))}
      </g>
    </>
  )
}

function QrArt() {
  const cells = [
    [0, 0, 1, 0, 1],
    [1, 0, 1, 1, 0],
    [0, 1, 0, 1, 1],
    [1, 1, 0, 0, 1],
    [0, 1, 1, 0, 1],
  ]
  return (
    <>
      <rect x="44" y="12" width="80" height="80" rx="12" {...card} />
      {[
        [52, 20],
        [94, 20],
        [52, 62],
      ].map(([x, y], i) => (
        <g key={i}>
          <rect x={x} y={y} width="22" height="22" rx="5" fill="none" strokeWidth="4" />
          <rect x={x + 7} y={y + 7} width="8" height="8" rx="2" stroke="none" />
        </g>
      ))}
      {cells.flatMap((row, r) =>
        row.map((c, k) =>
          c ? (
            <rect
              key={`${r}-${k}`}
              x={78 + k * 8}
              y={62 + r * 4.4}
              width="6"
              height="3.4"
              rx="1"
              stroke="none"
              opacity=".75"
            />
          ) : null,
        ),
      )}
      <g className="motion-decor" style={{ animation: 'float-y 2.2s ease-in-out infinite' }}>
        <rect x="38" y="52" width="92" height="2.5" rx="1.25" stroke="none" opacity=".8" />
      </g>
    </>
  )
}

function PdfArt() {
  return (
    <>
      <g className="motion-decor" style={floatStyle(3.4, 0.4)}>
        <rect x="62" y="14" width="64" height="82" rx="8" {...card} transform="rotate(8 94 55)" />
      </g>
      <g className="motion-decor" style={floatStyle(3.4)}>
        <rect x="42" y="18" width="64" height="82" rx="8" {...card} />
        <rect x="50" y="28" width="26" height="12" rx="3" stroke="none" />
        <text
          x="63"
          y="37"
          textAnchor="middle"
          fontSize="8"
          fontWeight="800"
          fill="#fff"
          stroke="none"
          fontFamily="Inter Variable, system-ui"
        >
          PDF
        </text>
        <rect x="50" y="48" width="48" height="4" rx="2" fill="var(--surface-3)" stroke="none" />
        <rect x="50" y="58" width="40" height="4" rx="2" fill="var(--surface-3)" stroke="none" />
        <rect x="50" y="68" width="44" height="4" rx="2" fill="var(--surface-3)" stroke="none" />
        <rect x="50" y="78" width="30" height="4" rx="2" fill="var(--surface-3)" stroke="none" />
      </g>
    </>
  )
}

function StitchArt() {
  return (
    <>
      <g className="motion-decor" style={floatStyle(3.2)}>
        <rect x="58" y="6" width="52" height="34" rx="7" {...card} />
        <path d="M64 34l10-11 7 7 5-5 8 9z" stroke="none" opacity=".55" />
      </g>
      <g className="motion-decor" style={floatStyle(3.2, 0.35)}>
        <rect x="58" y="43" width="52" height="30" rx="7" {...card} />
        <circle cx="96" cy="53" r="4" stroke="none" />
        <path d="M64 68l9-9 7 6 6-4 10 7z" stroke="none" opacity=".75" />
      </g>
      <g className="motion-decor" style={floatStyle(3.2, 0.7)}>
        <rect x="58" y="76" width="52" height="26" rx="7" {...card} />
        <path d="M64 97l8-8 6 5 7-6 11 9z" stroke="none" />
      </g>
      <path
        d="M46 10v88M42 14l4-4 4 4M42 94l4 4 4-4"
        fill="none"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity=".7"
      />
      <path
        d="M118 40h10M118 75h10"
        fill="none"
        strokeWidth="2"
        strokeDasharray="2 3"
        strokeLinecap="round"
        opacity=".6"
      />
    </>
  )
}

function PdfConvertArt() {
  return (
    <>
      <g className="motion-decor" style={floatStyle(3.3)}>
        <rect x="20" y="22" width="50" height="66" rx="8" {...card} />
        <rect x="27" y="31" width="22" height="10" rx="3" stroke="none" />
        <text
          x="38"
          y="38.6"
          textAnchor="middle"
          fontSize="7"
          fontWeight="800"
          fill="#fff"
          stroke="none"
          fontFamily="Inter Variable, system-ui"
        >
          PDF
        </text>
        <rect x="27" y="48" width="36" height="3.5" rx="1.75" fill="var(--surface-3)" stroke="none" />
        <rect x="27" y="57" width="30" height="3.5" rx="1.75" fill="var(--surface-3)" stroke="none" />
        <rect x="27" y="66" width="33" height="3.5" rx="1.75" fill="var(--surface-3)" stroke="none" />
      </g>
      <path
        d="M76 55h16m0 0-5-5m5 5-5 5"
        fill="none"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g className="motion-decor" style={floatStyle(3.3, 0.45)}>
        <rect x="98" y="14" width="46" height="38" rx="7" {...card} />
        <path d="M104 46l9-10 7 6 5-4 12 8z" stroke="none" opacity=".7" />
      </g>
      <g className="motion-decor" style={floatStyle(3.3, 0.8)}>
        <rect x="98" y="58" width="46" height="38" rx="7" {...card} />
        <rect x="105" y="67" width="32" height="3.5" rx="1.75" stroke="none" opacity=".8" />
        <rect x="105" y="75" width="26" height="3.5" rx="1.75" fill="var(--surface-3)" stroke="none" />
        <rect x="105" y="83" width="29" height="3.5" rx="1.75" fill="var(--surface-3)" stroke="none" />
      </g>
    </>
  )
}

function Doc2PdfArt() {
  return (
    <>
      <g className="motion-decor" style={floatStyle(3.1)}>
        <rect x="26" y="20" width="56" height="74" rx="8" {...card} />
        <text
          x="36"
          y="38"
          fontSize="11"
          fontWeight="800"
          stroke="none"
          fontFamily="ui-monospace, Menlo, monospace"
        >
          #
        </text>
        <rect x="46" y="31" width="28" height="4" rx="2" stroke="none" opacity=".8" />
        <rect x="34" y="46" width="40" height="3.5" rx="1.75" fill="var(--surface-3)" stroke="none" />
        <rect x="34" y="55" width="34" height="3.5" rx="1.75" fill="var(--surface-3)" stroke="none" />
        <rect x="34" y="64" width="38" height="3.5" rx="1.75" fill="var(--surface-3)" stroke="none" />
        <rect x="34" y="73" width="24" height="3.5" rx="1.75" fill="var(--surface-3)" stroke="none" />
      </g>
      <g className="motion-decor" style={floatStyle(3.1, 0.5)}>
        <rect x="92" y="26" width="52" height="68" rx="8" {...card} transform="rotate(6 118 60)" />
        <g transform="rotate(6 118 60)">
          <rect x="100" y="36" width="36" height="7" rx="2" stroke="none" />
          <rect x="100" y="50" width="34" height="3.5" rx="1.75" fill="var(--surface-3)" stroke="none" />
          <rect x="100" y="59" width="28" height="3.5" rx="1.75" fill="var(--surface-3)" stroke="none" />
          <rect x="100" y="68" width="32" height="3.5" rx="1.75" fill="var(--surface-3)" stroke="none" />
        </g>
      </g>
    </>
  )
}
