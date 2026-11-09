import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Mark } from '~/components/brand/logo'
import { useSession } from '~/data/store'

export const Route = createFileRoute('/demo')({
  ssr: false,
  head: () => ({ meta: [{ title: 'Live demo — Nau' }] }),
  component: Demo,
})

function Demo() {
  const navigate = useNavigate()
  useEffect(() => {
    void useSession
      .getState()
      .enterDemo()
      .then(() => navigate({ to: '/app', replace: true }))
  }, [navigate])
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 text-center">
      <Mark size={28} working className="text-ink" />
      <p className="text-[14px] text-ink-3">Opening Casa Ribeira — a deli with two shops and a warehouse…</p>
    </div>
  )
}
