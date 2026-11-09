import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AuthShell } from '~/components/auth/shell'
import { Button } from '~/components/ui/button'
import { Field, Input } from '~/components/ui/form'
import { useSession } from '~/data/store'

export const Route = createFileRoute('/reset-password')({
  head: () => ({ meta: [{ title: 'Nova password — Nau' }] }),
  component: Reset,
})

function Reset() {
  const navigate = useNavigate()
  const { init, backend } = useSession()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => void init(), [init])
  const submit = async () => {
    if (pw.length < 10) return setError('Usa pelo menos 10 caracteres')
    if (pw !== pw2) return setError('As passwords não coincidem')
    setBusy(true)
    setError(null)
    try {
      await backend?.updatePassword(pw)
      const ws = await useSession.getState().refreshWorkspaces()
      void navigate({ to: ws.length ? '/app' : '/onboarding' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível atualizar a password')
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthShell title="Escolhe uma nova password" subtitle="Entras logo a seguir.">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        noValidate
      >
        <Field label="Nova password" htmlFor="pw" hint="Pelo menos 10 caracteres.">
          <Input id="pw" type="password" autoComplete="new-password" inputSize="lg" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </Field>
        <Field label="Repete-a" htmlFor="pw2" error={error}>
          <Input id="pw2" type="password" autoComplete="new-password" inputSize="lg" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-invalid={!!error} />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
          Guardar e entrar
        </Button>
      </form>
    </AuthShell>
  )
}
