import { useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { EnvelopeSimpleIcon } from '@phosphor-icons/react'
import { AuthShell } from '~/components/auth/shell'
import { Button } from '~/components/ui/button'
import { Field, Input } from '~/components/ui/form'
import { useSession } from '~/data/store'
import { useEffect } from 'react'
import { tr } from '~/i18n'

export const Route = createFileRoute('/forgot-password')({
  head: () => ({ meta: [{ title: tr('Recuperar password — Nau') }] }),
  component: Forgot,
})

function Forgot() {
  const navigate = useNavigate()
  const { init, backend } = useSession()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => void init(), [init])
  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError(tr('Escreve um email válido'))
    setBusy(true)
    setError(null)
    try {
      await backend?.resetPassword(email)
      if (backend?.mode === 'local') void navigate({ to: '/reset-password' })
      else setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('Algo correu mal'))
    } finally {
      setBusy(false)
    }
  }
  if (sent)
    return (
      <AuthShell title={tr('Vê o teu email')} subtitle={tr('Se {0} tiver conta no Nau, o link para recuperar a password está a caminho. Expira numa hora.', email)} footer={<Link to="/login" className="underline underline-offset-2 hover:text-ink">{tr('Voltar a entrar')}</Link>}>
        <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
          <EnvelopeSimpleIcon size={22} />
        </div>
      </AuthShell>
    )
  return (
    <AuthShell title={tr('Recuperar password')} subtitle={tr('Enviamos-te um link para escolheres uma nova.')} footer={<Link to="/login" className="underline underline-offset-2 hover:text-ink">{tr('Voltar a entrar')}</Link>}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        noValidate
      >
        <Field label={tr('Email')} htmlFor="email" error={error}>
          <Input id="email" type="email" autoComplete="email" inputSize="lg" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus aria-invalid={!!error} />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
          {tr('Enviar link')}
        </Button>
      </form>
    </AuthShell>
  )
}
