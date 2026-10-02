import { useT } from '@/i18n'

/**
 * 示意動畫：檔案（三種模組色的小卡）從左方飛進瀏覽器視窗，在裡面被處理（閃一下），
 * 沒有任何箭頭離開。純 CSS／SVG，動畫強度精簡／關閉時停止（.motion-decor）。
 */
export function PrivacyDiagram() {
  const t = useT()
  const files = [
    { c1: '#5BE08A', c2: '#16A34A', delay: 0 },
    { c1: '#FF8A5B', c2: '#D9480F', delay: 1.3 },
    { c1: '#F07CF5', c2: '#C026D3', delay: 2.6 },
  ]
  return (
    <figure className="relative mx-auto w-full max-w-[420px]">
      <svg
        viewBox="0 0 420 260"
        role="img"
        aria-label={t('home.privacyDiagram')}
        className="w-full overflow-visible"
      >
        <defs>
          <linearGradient id="pd-brand" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#5AA2FF" />
            <stop offset="1" stopColor="#2F6BEA" />
          </linearGradient>
          {files.map((f, i) => (
            <linearGradient key={i} id={`pd-f${i}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={f.c1} />
              <stop offset="1" stopColor={f.c2} />
            </linearGradient>
          ))}
          <clipPath id="pd-win">
            <rect x="110" y="30" width="290" height="200" rx="16" />
          </clipPath>
        </defs>
        {/* 瀏覽器視窗 */}
        <rect
          x="110"
          y="30"
          width="290"
          height="200"
          rx="16"
          fill="var(--surface)"
          stroke="var(--border-strong)"
          strokeWidth="1.5"
        />
        <path d="M110 46a16 16 0 0 1 16-16h258a16 16 0 0 1 16 16v14H110z" fill="var(--surface-2)" />
        <circle cx="128" cy="45" r="4" fill="#FF7A7A" />
        <circle cx="142" cy="45" r="4" fill="#FBBF24" />
        <circle cx="156" cy="45" r="4" fill="#5BE08A" />
        <rect x="176" y="39" width="150" height="12" rx="6" fill="var(--surface-3)" />
        <path d="M184 45h0" stroke="var(--text-3)" />
        {/* 鎖頭 */}
        <g
          transform="translate(182 40)"
          fill="none"
          stroke="var(--success)"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          <rect x="0" y="4" width="8" height="6" rx="1.5" fill="var(--success)" stroke="none" />
          <path d="M1.8 4V2.6a2.2 2.2 0 0 1 4.4 0V4" />
        </g>
        {/* 處理核心 */}
        <g transform="translate(255 142)">
          <circle
            r="40"
            fill="url(#pd-brand)"
            opacity=".1"
            className="motion-decor"
            style={{
              animation: 'breathe 3.9s ease-in-out infinite',
              transformBox: 'fill-box',
              transformOrigin: 'center',
            }}
          />
          <rect x="-22" y="-22" width="44" height="44" rx="10" fill="url(#pd-brand)" />
          <path d="M-5 -9v18l15-9z" fill="#fff" />
        </g>
        {/* 檔案飛入 */}
        <g clipPath="url(#pd-win)">
          {files.map((f, i) => (
            <g
              key={i}
              className="motion-decor"
              style={{
                animation: `pd-in 3.9s cubic-bezier(.16,1,.3,1) ${f.delay}s infinite`,
                opacity: 0,
              }}
            >
              <rect
                x="-26"
                y="-32"
                width="40"
                height="50"
                rx="7"
                fill={`url(#pd-f${i})`}
                transform="translate(255 142)"
              />
            </g>
          ))}
        </g>
        {files.map((f, i) => (
          <g
            key={`o${i}`}
            className="motion-decor"
            style={{
              animation: `pd-out 3.9s cubic-bezier(.16,1,.3,1) ${f.delay}s infinite`,
              opacity: 0,
            }}
          >
            <rect x="0" y="0" width="40" height="50" rx="7" fill={`url(#pd-f${i})`} />
            <rect x="8" y="10" width="24" height="4" rx="2" fill="#fff" opacity=".7" />
            <rect x="8" y="18" width="16" height="4" rx="2" fill="#fff" opacity=".5" />
          </g>
        ))}
        {/* 封閉的邊界：沒有出口 */}
        <rect
          x="104"
          y="24"
          width="302"
          height="212"
          rx="20"
          fill="none"
          stroke="var(--success)"
          strokeWidth="1.5"
          strokeDasharray="4 6"
          opacity=".5"
        />
      </svg>
      <style>{`
        @keyframes pd-out {
          0% { transform: translate(10px, 150px) rotate(-8deg); opacity: 0 }
          10% { opacity: 1 }
          45% { transform: translate(150px, 100px) rotate(0deg); opacity: 1 }
          55% { transform: translate(200px, 100px) scale(.6); opacity: 0 }
          100% { transform: translate(200px, 100px) scale(.6); opacity: 0 }
        }
        @keyframes pd-in {
          0%, 50% { opacity: 0; transform: scale(.4) }
          60% { opacity: .9; transform: scale(1) }
          80% { opacity: 0; transform: scale(.2) }
          100% { opacity: 0 }
        }
      `}</style>
    </figure>
  )
}
