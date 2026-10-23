import { Toaster as Sonner, toast as sonnerToast } from 'sonner'
import { useSettings, resolveTheme } from '@/stores/settings'

/** Toast：右下彈入、可滑動關閉（sonner），外觀套用設計 token */
export function Toaster() {
  const theme = useSettings((s) => s.theme)
  return (
    <Sonner
      position="bottom-right"
      theme={resolveTheme(theme)}
      offset={{ bottom: 88, right: 20 }}
      mobileOffset={{ bottom: 96 }}
      gap={10}
      visibleToasts={4}
      toastOptions={{
        classNames: {
          toast: 'jt-toast',
          title: 'jt-toast-title',
          description: 'jt-toast-desc',
          actionButton: 'jt-toast-action',
          cancelButton: 'jt-toast-cancel',
        },
      }}
    />
  )
}

export const toast = sonnerToast
