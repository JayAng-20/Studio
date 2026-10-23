/** 準備畫面用的裝置 hook：裝置清單、麥克風試音、鏡頭預覽、權限狀態 */
import { useEffect, useState } from 'react'
import { classifyMediaError, type MediaErrorKind } from './core'
import { getUserMediaWithFallback, micConstraints } from './engine'

/** 裝置清單（插拔時自動更新）；沒有權限前 label 會是空字串 */
export function useDevices(kind: 'audioinput' | 'videoinput', refreshKey: unknown) {
  const [list, setList] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md?.enumerateDevices) return
    let alive = true
    const load = () =>
      md
        .enumerateDevices()
        .then((all) => {
          if (alive) setList(all.filter((d) => d.kind === kind && d.deviceId !== ''))
        })
        .catch((e) => console.error(e))
    void load()
    md.addEventListener?.('devicechange', load)
    return () => {
      alive = false
      md.removeEventListener?.('devicechange', load)
    }
  }, [kind, refreshKey])
  return list
}

/** 權限是否已允許（不支援查詢時回傳 'unknown'） */
export function usePermission(name: 'microphone' | 'camera') {
  const [state, setState] = useState<PermissionState | 'unknown'>('unknown')
  useEffect(() => {
    let status: PermissionStatus | null = null
    let alive = true
    const on = () => {
      if (alive && status) setState(status.state)
    }
    navigator.permissions
      ?.query({ name: name as PermissionName })
      .then((s) => {
        status = s
        on()
        s.addEventListener('change', on)
      })
      .catch(() => {})
    return () => {
      alive = false
      status?.removeEventListener('change', on)
    }
  }, [name])
  return state
}

interface PreviewState<T> {
  value: T | null
  error: MediaErrorKind | null
  key: string
}

/** 麥克風試音：回傳 AnalyserNode 供音量條使用 */
export function useMicPreview(active: boolean, deviceId: string) {
  const key = `${active}|${deviceId}`
  const [state, setState] = useState<PreviewState<AnalyserNode>>({
    value: null,
    error: null,
    key: '',
  })
  useEffect(() => {
    if (!active) return
    let cancelled = false
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    const resume = () => ctx?.resume().catch(() => {})
    void (async () => {
      try {
        stream = await getUserMediaWithFallback({ audio: micConstraints(deviceId), video: false })
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop())
          return
        }
        ctx = new AudioContext()
        const src = ctx.createMediaStreamSource(stream)
        const an = ctx.createAnalyser()
        an.fftSize = 512
        an.smoothingTimeConstant = 0.6
        src.connect(an)
        resume()
        // 自動播放政策：沒有使用者手勢時 AudioContext 會暫停，點一下頁面就恢復
        document.addEventListener('pointerdown', resume)
        setState({ value: an, error: null, key })
      } catch (e) {
        if (cancelled) return
        console.error(e)
        setState({ value: null, error: classifyMediaError(e, 'user'), key })
      }
    })()
    return () => {
      cancelled = true
      document.removeEventListener('pointerdown', resume)
      stream?.getTracks().forEach((tr) => tr.stop())
      ctx?.close().catch(() => {})
    }
  }, [active, deviceId, key])
  const current = active && state.key === key
  return {
    analyser: current ? state.value : null,
    error: current ? state.error : null,
    loading: active && state.key !== key,
  }
}

/** 鏡頭預覽：回傳 MediaStream */
export function useCameraPreview(active: boolean, deviceId: string) {
  const key = `${active}|${deviceId}`
  const [state, setState] = useState<PreviewState<MediaStream>>({
    value: null,
    error: null,
    key: '',
  })
  useEffect(() => {
    if (!active) return
    let cancelled = false
    let stream: MediaStream | null = null
    void (async () => {
      try {
        stream = await getUserMediaWithFallback({
          video: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop())
          return
        }
        setState({ value: stream, error: null, key })
      } catch (e) {
        if (cancelled) return
        console.error(e)
        setState({ value: null, error: classifyMediaError(e, 'user'), key })
      }
    })()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((tr) => tr.stop())
    }
  }, [active, deviceId, key])
  const current = active && state.key === key
  return {
    stream: current ? state.value : null,
    error: current ? state.error : null,
    loading: active && state.key !== key,
  }
}
