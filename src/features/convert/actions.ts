/** 下載與打包 */
import { createZip } from '@/lib/zip'
import { downloadBlob, saveLargeBlob } from '@/lib/download'
import { isAbortError, type TaskContext, type TaskResult } from '@/stores/tasks'
import { toast } from '@/components/ui'
import { t } from '@/i18n'
import { formatDate } from './lib/naming'
import { useConvert, type ConvertItem } from './store'

type RunTask = <T extends TaskResult[] | void>(
  name: string,
  fn: (ctx: TaskContext) => Promise<T>,
  opts?: { signal?: AbortSignal },
) => Promise<T>

export const doneItems = (items: ConvertItem[]) =>
  items.filter((x): x is ConvertItem & { result: NonNullable<ConvertItem['result']> } => x.status === 'done' && !!x.result)

/** 一個檔案直接下載；多個檔案打包成 ZIP（走任務中心，可取消） */
export async function downloadResults(run: RunTask, items: ConvertItem[]) {
  const done = doneItems(items)
  if (!done.length) return
  if (done.length === 1) {
    downloadBlob(done[0].result.blob, done[0].result.name)
    useConvert.getState().markDelivered()
    return
  }
  const name = `${t('convert.zipName')}_${formatDate(new Date())}.zip`
  try {
    await run(t('convert.task.zip', { count: done.length }), async ({ signal, progress }) => {
      progress(null)
      const zip = await createZip(
        done.map((x) => ({ name: x.result.name, data: x.result.blob })),
        signal,
      )
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      await saveLargeBlob(zip, name)
      useConvert.getState().markDelivered()
      return [{ blob: zip, name }]
    })
  } catch (e) {
    if (isAbortError(e)) return
    console.error(e)
    toast.error(t('convert.errors.zip.title'), { description: t('convert.errors.zip.desc') })
  }
}
