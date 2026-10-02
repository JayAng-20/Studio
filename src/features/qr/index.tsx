import { QrCode, ScanLine } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { Badge, TabPanel, Tabs } from '@/components/ui'
import { ModulePage } from '@/components/layout/ModulePage'
import { useIncomingFiles } from '@/stores/fileBus'
import { fileKind } from '@/lib/files'
import { duration } from '@/design/motion'
import { useT } from '@/i18n'
import { Generator } from './generate/Generator'
import { Scanner } from './scan/Scanner'
import type { IncomingImage } from './scan/ImageScanner'
import { useQrStore, type QrTab } from './store'
import './qr.css'

/** 裝飾性循環動畫的週期（由 motion token 推得） */
const decorVars = {
  '--qr-breathe': `${duration.hero * 3}ms`,
  '--qr-scan': `${duration.hero * 2}ms`,
} as CSSProperties

function StatusBadge() {
  const t = useT()
  const tab = useQrStore((s) => s.tab)
  const scan = useQrStore((s) => s.scanStatus)
  if (tab === 'generate') return <Badge tone="accent">{t('qr.status.live')}</Badge>
  const map = {
    idle: { tone: 'neutral', key: 'qr.status.waiting' },
    camera: { tone: 'accent', key: 'qr.status.cameraOn' },
    continuous: { tone: 'accent', key: 'qr.status.continuous' },
    image: { tone: 'accent', key: 'qr.status.imageScanning' },
    found: { tone: 'success', key: 'qr.status.found' },
  } as const
  const s = map[scan]
  return (
    <Badge tone={s.tone} className="tabular-nums">
      <span aria-live="polite">{t(s.key)}</span>
    </Badge>
  )
}

export default function Page() {
  const t = useT()
  const tab = useQrStore((s) => s.tab)
  const setTab = useQrStore((s) => s.setTab)
  const [incoming, setIncoming] = useState<IncomingImage | null>(null)

  // 其他模組或首頁拖放傳來的圖片：切到「掃描」並辨識
  useIncomingFiles('qr', (p) => {
    const img = p.files.find((f) => fileKind(f) === 'image')
    if (!img) return
    setTab('scan')
    setIncoming({ file: img, nonce: Date.now() })
  })

  return (
    <ModulePage module="qr" status={<StatusBadge />}>
      <div style={decorVars}>
        <Tabs<QrTab>
          value={tab}
          onChange={setTab}
          label={t('qr.tabs.label')}
          listClassName="mb-5 lg:mb-6"
          items={[
            {
              value: 'generate',
              label: (
                <>
                  <QrCode size={16} aria-hidden />
                  {t('qr.tabs.generate')}
                </>
              ),
            },
            {
              value: 'scan',
              label: (
                <>
                  <ScanLine size={16} aria-hidden />
                  {t('qr.tabs.scan')}
                </>
              ),
            },
          ]}
        >
          <TabPanel value={tab}>
            {tab === 'generate' ? <Generator /> : <Scanner incoming={incoming} />}
          </TabPanel>
        </Tabs>
      </div>
    </ModulePage>
  )
}
