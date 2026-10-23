import { AnimatePresence, motion } from 'motion/react'
import { Upload } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { modules, type ModuleId } from '@/config/modules'
import { Dialog, IconTile } from '@/components/ui'
import { useFileBus } from '@/stores/fileBus'
import { fileKind, filesFromDataTransfer } from '@/lib/files'
import { spring, staggerDelay } from '@/design/motion'
import { useT, type TKey } from '@/i18n'

type Kind = 'image' | 'pdf' | 'video' | 'audio' | 'text'

/** 首頁全域拖放：依檔案類型建議工具，選了就帶著檔案跳轉 */
export function HomeDropDispatch({ children }: { children: ReactNode }) {
  const t = useT()
  const nav = useNavigate()
  const send = useFileBus((s) => s.send)
  const [over, setOver] = useState(false)
  const [files, setFiles] = useState<File[] | null>(null)
  const depth = useRef(0)
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types || []).includes('Files')

  const kinds = new Set(
    (files ?? [])
      .map((f) => fileKind(f))
      .filter(
        (k): k is Kind =>
          k === 'image' || k === 'pdf' || k === 'video' || k === 'audio' || k === 'text',
      ),
  )
  const kindLabel: TKey =
    kinds.size > 1
      ? 'home.kinds.mixed'
      : kinds.size === 1
        ? (`home.kinds.${[...kinds][0]}` as TKey)
        : 'home.kinds.other'
  const suggestions = modules.filter((m) => m.opens.some((k) => kinds.has(k)))
  // 較適合的排前面：完全涵蓋所有類型者優先
  suggestions.sort(
    (a, b) =>
      Number([...kinds].every((k) => b.opens.includes(k))) -
      Number([...kinds].every((k) => a.opens.includes(k))),
  )

  const choose = (id: ModuleId) => {
    if (!files) return
    const m = modules.find((x) => x.id === id)!
    send(
      id,
      'home',
      files.filter((f) => m.opens.includes(fileKind(f) as Kind)),
    )
    setFiles(null)
    nav(m.path)
  }

  return (
    <div
      className="relative"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        depth.current++
        setOver(true)
      }}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (!depth.current) setOver(false)
      }}
      onDrop={async (e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        depth.current = 0
        setOver(false)
        const list = await filesFromDataTransfer(e.dataTransfer)
        if (list.length) setFiles(list)
      }}
    >
      {children}
      <AnimatePresence>
        {over && (
          <motion.div
            className="pointer-events-none fixed inset-0 z-[65] grid place-items-center bg-[color-mix(in_srgb,var(--bg)_60%,transparent)] backdrop-blur-[6px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent bg-surface px-12 py-10 shadow-e4"
              initial={{ scale: 0.92 }}
              animate={{ scale: 1 }}
              transition={spring.bouncy}
            >
              <Upload size={32} className="text-accent-ink" aria-hidden />
              <p className="text-h2 font-semibold">{t('home.dropHint')}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <Dialog
        open={!!files}
        onOpenChange={(o) => !o && setFiles(null)}
        title={t('home.dropTitle')}
        description={t('home.dropDesc', { count: files?.length ?? 0, kind: t(kindLabel) })}
        size="md"
      >
        {suggestions.length ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {suggestions.map((m, i) => (
              <motion.li
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring.smooth, delay: staggerDelay(i) }}
              >
                <button
                  type="button"
                  onClick={() => choose(m.id)}
                  className="card flex w-full items-center gap-3 p-3 text-left transition-shadow hover:shadow-e2 focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <IconTile module={m.id} size="md" />
                  <span className="min-w-0">
                    <span className="block font-semibold">{t(m.nameKey)}</span>
                    <span className="line-clamp-2 block text-caption text-text-3">
                      {t(m.descKey)}
                    </span>
                  </span>
                </button>
              </motion.li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-text-2">{t('home.dropNoMatch')}</p>
        )}
      </Dialog>
    </div>
  )
}
