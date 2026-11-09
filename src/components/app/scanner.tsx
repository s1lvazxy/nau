import { useEffect, useRef, useState } from 'react'
import { BarcodeIcon, CameraSlashIcon } from '@phosphor-icons/react'
import { Input } from '~/components/ui/form'
import { cn } from '~/lib/utils'

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> }

/** Camera barcode scanner: native BarcodeDetector when available, ZXing otherwise. Keyboard-wedge scanners work through the input. */
export function Scanner({ onDetect, className, compact }: { onDetect: (code: string) => void; className?: string; compact?: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<'idle' | 'starting' | 'live' | 'denied' | 'unsupported'>('idle')
  const [manual, setManual] = useState('')
  const last = useRef<{ code: string; at: number }>({ code: '', at: 0 })
  const emit = (code: string) => {
    const now = Date.now()
    if (code === last.current.code && now - last.current.at < 1800) return
    last.current = { code, at: now }
    try {
      navigator.vibrate?.(30)
    } catch {
      /* not supported */
    }
    onDetect(code)
  }

  useEffect(() => {
    if (state !== 'starting') return
    let stream: MediaStream | null = null
    let stop = false
    let zxingControls: { stop: () => void } | null = null
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) return setState('unsupported')
        const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector
        if (Native) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false })
          if (!video.current) return
          video.current.srcObject = stream
          await video.current.play()
          setState('live')
          const det = new Native({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] })
          const tick = async () => {
            if (stop || !video.current) return
            try {
              const r = await det.detect(video.current)
              if (r[0]?.rawValue) emit(r[0].rawValue)
            } catch {
              /* frame not ready */
            }
            setTimeout(tick, 160)
          }
          void tick()
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser')
          const reader = new BrowserMultiFormatReader()
          if (!video.current) return
          zxingControls = await reader.decodeFromVideoDevice(undefined, video.current, (res) => {
            if (res) emit(res.getText())
          })
          setState('live')
        }
      } catch (e) {
        setState((e as Error)?.name === 'NotAllowedError' ? 'denied' : 'unsupported')
      }
    })()
    return () => {
      stop = true
      zxingControls?.stop()
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [state === 'starting'])

  useEffect(
    () => () => {
      const v = video.current
      const s = v?.srcObject as MediaStream | null
      s?.getTracks().forEach((t) => t.stop())
    },
    [],
  )

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className={cn('relative overflow-hidden rounded-[16px] bg-[#0d0d0f]', compact ? 'aspect-[16/9]' : 'aspect-[4/3]')}>
        <video ref={video} className={cn('absolute inset-0 h-full w-full object-cover', state !== 'live' && 'opacity-0')} playsInline muted />
        {state === 'live' ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
            <div className="relative h-[38%] w-[72%] rounded-[14px] ring-2 ring-white/85 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]">
              <div className="absolute inset-x-3 top-1/2 h-px animate-pulse bg-[var(--orange-9)] shadow-[0_0_14px_var(--orange-9)]" />
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
            {state === 'denied' || state === 'unsupported' ? <CameraSlashIcon size={26} className="text-white/70" /> : <BarcodeIcon size={26} className="text-white/70" />}
            <p className="max-w-[260px] text-[13px] text-white/70">{state === 'denied' ? 'Camera access was blocked. Allow it in your browser settings, or type the code below.' : state === 'unsupported' ? 'This browser can’t use the camera here. Type or scan the code below.' : 'Point the camera at a barcode. Works best in good light.'}</p>
            {(state === 'idle' || state === 'starting') && (
              <button type="button" onClick={() => setState('starting')} className="press mt-1 h-9 rounded-full bg-white px-4 text-[13px] font-medium text-black">
                {state === 'starting' ? 'Starting camera…' : 'Start camera'}
              </button>
            )}
          </div>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (manual.trim()) {
            emit(manual.trim())
            setManual('')
          }
        }}
      >
        <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Type a barcode or SKU — USB scanners work here too" leading={<BarcodeIcon size={14} />} aria-label="Barcode or SKU" inputMode="numeric" />
      </form>
    </div>
  )
}
