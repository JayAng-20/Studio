import { motion } from 'motion/react'
import { ArrowRight, Clock, Lock, ShieldCheck, UserX, WifiOff, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { useEffect, type CSSProperties } from 'react'
import { groups, moduleById, modules, preloadModule, type ModuleDef } from '@/config/modules'
import { app } from '@/config/app'
import { Logo } from '@/design/Logo'
import { Badge, Button, Card, FileName, IconTile } from '@/components/ui'
import { useRecents } from '@/stores/recents'
import { useUi } from '@/stores/ui'
import { duration, easing, sec, spring, staggerDelay } from '@/design/motion'
import { useT } from '@/i18n'
import { HomeDropDispatch } from './HomeDropDispatch'
import { PrivacyDiagram } from './PrivacyDiagram'

export default function Home() {
  const t = useT()
  // 閒置時預取各模組 chunk
  useEffect(() => {
    const ric = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
      }
    ).requestIdleCallback
    const run = () => modules.forEach((m) => preloadModule(m.id))
    if (ric) {
      const id = ric(run, { timeout: 4000 })
      return () =>
        (window as unknown as { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(id)
    }
    const id = setTimeout(run, 2500)
    return () => clearTimeout(id)
  }, [])

  return (
    <HomeDropDispatch>
      <div className="mx-auto w-full max-w-[var(--content-max)] px-4 pb-28 sm:px-6 sm:pb-12 lg:px-8">
        <Hero />
        <Recents />
        <section id="tools" aria-labelledby="tools-title" className="scroll-mt-20 pt-6">
          <h2 id="tools-title" className="sr-only">
            {t('home.toolsTitle')}
          </h2>
          <div className="flex flex-col gap-10">
            {groups.map((g, gi) => (
              <div key={g.id}>
                <h3 className="mb-4 text-caption font-semibold uppercase tracking-[.08em] text-text-3">
                  {t(g.labelKey)}
                </h3>
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {modules
                    .filter((m) => m.group === g.id)
                    .map((m, i) => (
                      <motion.li
                        key={m.id}
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ ...spring.gentle, delay: staggerDelay(gi * 3 + i, 0.35) }}
                      >
                        <ToolCard m={m} />
                      </motion.li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
        <Privacy />
        <Footer />
      </div>
    </HomeDropDispatch>
  )
}

function Hero() {
  const t = useT()
  const words = t('home.heroTitleWords').split('|')
  return (
    <section className="relative flex flex-col items-center pb-10 pt-12 text-center sm:pt-20 lg:pb-14">
      <div
        className="motion-decor mb-7"
        style={{ animation: 'float-y 6s ease-in-out 1.2s infinite' }}
      >
        <Logo size={96} animate hoverSpin delay={0.15} title={t('a11y.logo', { name: app.name })} />
      </div>
      <h1 className="text-[32px] leading-[40px] font-bold tracking-[-0.02em] sm:text-display">
        <span className="sr-only">{t('home.heroTitle')}</span>
        <span aria-hidden className="inline">
          {words.map((w, i) => (
            <span key={i} className="inline-block overflow-hidden pb-1 align-bottom">
              <motion.span
                className="inline-block"
                initial={{ y: '110%' }}
                animate={{ y: 0 }}
                transition={{
                  duration: sec(duration.slower),
                  ease: easing.emphasized,
                  delay: 0.25 + i * 0.08,
                }}
              >
                {w}
              </motion.span>
              {/* 英文等以空白分詞的語言，詞組之間補回空白（行內區塊會吃掉尾端空白） */}
              {i < words.length - 1 && /[A-Za-z0-9,.!?]$/.test(w) ? '\u00a0' : null}
            </span>
          ))}
        </span>
      </h1>
      <motion.p
        className="mt-4 max-w-xl text-[15px] leading-6 text-text-2 sm:text-h3"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring.gentle, delay: 0.5 }}
      >
        {t('app.taglineShort')}
      </motion.p>
      <motion.div
        className="mt-7 flex flex-wrap items-center justify-center gap-3"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring.gentle, delay: 0.6 }}
      >
        <Button
          variant="primary"
          size="lg"
          trailing={<ArrowRight size={18} aria-hidden />}
          onClick={() =>
            document.getElementById('tools')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        >
          {t('home.start')}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          leading={<ShieldCheck size={18} aria-hidden />}
          onClick={() =>
            document
              .getElementById('privacy')
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        >
          {t('home.privacy')}
        </Button>
      </motion.div>
    </section>
  )
}

function ToolCard({ m }: { m: ModuleDef }) {
  const t = useT()
  return (
    <Link
      to={m.path}
      className="group block h-full rounded-lg"
      onPointerEnter={() => preloadModule(m.id)}
      onFocus={() => preloadModule(m.id)}
      style={{ '--card-glow': m.m2 } as CSSProperties}
    >
      <Card
        interactive
        tilt
        className="flex h-full items-start gap-4 max-sm:items-center sm:flex-col sm:p-6"
      >
        <IconTile
          module={m.id}
          size="lg"
          layoutId={`tile-${m.id}`}
          glyphClassName={`glyph-${m.id}`}
        />
        <div className="min-w-0 flex-1">
          <motion.h4
            layoutId={`title-${m.id}`}
            transition={spring.smooth}
            className="w-fit text-h3 font-semibold text-text"
          >
            {t(m.nameKey)}
          </motion.h4>
          <p className="mt-1 text-small text-text-2">{t(m.descKey)}</p>
          <div className="mt-3 flex flex-wrap gap-1.5 max-sm:hidden">
            {m.tagKeys.map((k) => (
              <Badge key={k}>{t(k)}</Badge>
            ))}
            <Badge>{t('common.offline')}</Badge>
          </div>
        </div>
        <ArrowRight
          size={18}
          aria-hidden
          className="shrink-0 self-center text-text-3 transition-transform duration-(--dur-base) group-hover:translate-x-1 sm:hidden"
        />
      </Card>
    </Link>
  )
}

function Recents() {
  const t = useT()
  const entries = useRecents((s) => s.entries)
  const clear = useRecents((s) => s.clear)
  const nav = useNavigate()
  if (!entries.length) return null
  return (
    <section aria-labelledby="recent-title" className="pb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="recent-title" className="flex items-center gap-2 text-h3 font-semibold">
          <Clock size={16} aria-hidden className="text-text-3" />
          {t('home.recentTitle')}
        </h2>
        <Button variant="ghost" size="sm" leading={<X size={14} aria-hidden />} onClick={clear}>
          {t('home.recentClear')}
        </Button>
      </div>
      <ul className="hide-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {entries.slice(0, 12).map((e, i) => {
          const m = moduleById[e.module]
          if (!m) return null
          return (
            <motion.li
              key={`${e.module}-${e.fileName ?? ''}-${e.at}`}
              className="snap-start"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...spring.gentle, delay: staggerDelay(i) }}
            >
              <button
                type="button"
                onClick={() => nav(m.path)}
                className="card flex h-16 w-[240px] items-center gap-3 px-3 text-left transition-shadow hover:shadow-e2"
              >
                <IconTile module={m.id} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium">{t(m.nameKey)}</span>
                  {e.fileName ? (
                    <FileName name={e.fileName} className="text-caption text-text-3" />
                  ) : (
                    <span className="block text-caption text-text-3">
                      {new Date(e.at).toLocaleDateString()}
                    </span>
                  )}
                </span>
              </button>
            </motion.li>
          )
        })}
      </ul>
    </section>
  )
}

function Privacy() {
  const t = useT()
  const points = [
    {
      icon: <Lock size={20} aria-hidden />,
      title: t('home.privacyPoints.localTitle'),
      desc: t('home.privacyPoints.localDesc'),
    },
    {
      icon: <UserX size={20} aria-hidden />,
      title: t('home.privacyPoints.accountTitle'),
      desc: t('home.privacyPoints.accountDesc'),
    },
    {
      icon: <WifiOff size={20} aria-hidden />,
      title: t('home.privacyPoints.offlineTitle'),
      desc: t('home.privacyPoints.offlineDesc'),
    },
  ]
  return (
    <section id="privacy" aria-labelledby="privacy-title" className="scroll-mt-20 pt-16">
      <div className="card overflow-hidden p-6 sm:p-10">
        <div className="grid items-center gap-8 lg:grid-cols-[1fr_minmax(0,420px)]">
          <div>
            <h2 id="privacy-title" className="text-h1 font-semibold tracking-[-0.01em]">
              {t('home.privacyTitle')}
            </h2>
            <ul className="mt-6 flex flex-col gap-5">
              {points.map((p) => (
                <li key={p.title} className="flex gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-md bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent-ink">
                    {p.icon}
                  </span>
                  <div>
                    <h3 className="text-h3 font-semibold">{p.title}</h3>
                    <p className="mt-0.5 text-body text-text-2">{p.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <PrivacyDiagram />
        </div>
      </div>
    </section>
  )
}

function Footer() {
  const t = useT()
  const setUi = useUi((s) => s.set)
  return (
    <footer className="mt-16 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 text-small text-text-3 sm:flex-row">
      <div className="flex items-center gap-2">
        <Logo size={20} />
        <span>
          {app.name} · {t('home.footer.version', { version: app.version })}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          className="rounded-sm hover:text-text"
          onClick={() => setUi({ shortcutsOpen: true })}
        >
          {t('home.footer.shortcuts')}
        </button>
        <a
          href={app.github}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-sm hover:text-text"
        >
          {t('home.footer.source')}
        </a>
        <span>{t('home.footer.license', { license: app.license })}</span>
      </div>
    </footer>
  )
}
