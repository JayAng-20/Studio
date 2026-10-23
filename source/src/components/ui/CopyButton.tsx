import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, type ButtonProps } from './Button'
import { spring, timing } from '@/design/motion'
import { useT } from '@/i18n'
import { toast } from './Toast'

/** 複製按鈕：成功時圖示變形成勾勾，1.2 秒後還原 */
export function CopyButton({
  onCopy,
  label,
  iconOnly,
  ...rest
}: Omit<ButtonProps, 'onClick'> & {
  onCopy: () => Promise<boolean> | boolean
  label?: string
  iconOnly?: boolean
}) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const click = async () => {
    const ok = await onCopy()
    if (!ok) {
      toast.error(t('common.copyFailed'))
      return
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), timing.copiedReset)
  }
  const icon = (
    <span className="relative grid size-4 place-items-center">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={copied ? 'y' : 'n'}
          initial={{ scale: 0.4, opacity: 0, rotate: -30 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={spring.bouncy}
          className={copied ? 'text-success-ink' : undefined}
        >
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
        </motion.span>
      </AnimatePresence>
    </span>
  )
  const text = copied ? t('common.copied') : (label ?? t('common.copy'))
  return (
    <Button
      {...rest}
      icon={iconOnly}
      aria-label={iconOnly ? text : undefined}
      leading={iconOnly ? undefined : icon}
      onClick={click}
    >
      {iconOnly ? icon : text}
      <span className="sr-only" aria-live="polite">
        {copied ? t('common.copied') : ''}
      </span>
    </Button>
  )
}
