import { useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { EnvelopeSimpleIcon } from '@phosphor-icons/react'
import { AuthShell, Divider, GoogleIcon } from '~/components/auth/shell'
import { errorText, useRedirectIfSignedIn } from '~/components/auth/hooks'
import { Button } from '~/components/ui/button'
import { Field, Input } from '~/components/ui/form'
import { primaryMode, useSession } from '~/data/store'
import { isCloudConfigured } from '~/lib/env'
import { msg, tr } from '~/i18n'

export const Route = createFileRoute('/login')({
  head: () => ({ meta: [{ title: tr('Entrar — Nau') }] }),
  component: Login,
})

const schema = z.object({ email: z.email(msg('Escreve um email válido')), password: z.string().min(1, msg('Escreve a tua password')) })
const magicSchema = z.object({ email: z.email(msg('Escreve um email válido')), password: z.string() })

function Login() {
  useRedirectIfSignedIn()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [magic, setMagic] = useState(false)
  const form = useForm({
    defaultValues: { email: '', password: '' },
    validators: { onSubmit: magic ? magicSchema : schema },
    onSubmit: async ({ value }) => {
      setError(null)
      const s = useSession.getState()
      if (s.session?.mode === 'demo') await s.leaveDemo()
      const backend = useSession.getState().backend
      try {
        if (!backend) throw new Error(tr('Ainda a arrancar — tenta outra vez.'))
        if (magic) {
          await backend.magicLink(value.email)
          setSent(value.email)
          return
        }
        await backend.signIn(value)
        const ws = await useSession.getState().refreshWorkspaces()
        void navigate({ to: ws.length ? '/app' : '/onboarding' })
      } catch (e) {
        setError(e instanceof Error ? e.message : tr('Não foi possível entrar'))
      }
    },
  })
  if (sent)
    return (
      <AuthShell title={tr('Vê o teu email')} subtitle={tr('Enviámos um link de entrada para {0}. Só funciona uma vez e expira numa hora.', sent)} footer={<button className="underline underline-offset-2 hover:text-ink" onClick={() => setSent(null)}>{tr('Usar outro email')}</button>}>
        <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
          <EnvelopeSimpleIcon size={22} />
        </div>
      </AuthShell>
    )
  return (
    <AuthShell
      title={tr('Bem-vindo de volta')}
      subtitle={tr('Entra no teu espaço de trabalho.')}
      footer={
        <>
          {tr('Novo no Nau?')}
          <Link to="/signup" className="font-medium text-ink underline-offset-2 hover:underline">
            {tr('Criar conta')}
          </Link> {tr('· ou')}
          <Link to="/demo" className="font-medium text-ink underline-offset-2 hover:underline">
            {tr('abrir a demo')}
          </Link>
        </>
      }
    >
      {isCloudConfigured && (
        <>
          <Button size="lg" className="w-full" onClick={() => void useSession.getState().backend?.oauth('google').catch((e: Error) => setError(e.message))} icon={<GoogleIcon />}>
            {tr('Continuar com Google')}
          </Button>
          <Divider>{tr('ou com email')}</Divider>
        </>
      )}
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
        noValidate
      >
        <form.Field name="email">
          {(f) => (
            <Field label={tr('Email')} htmlFor="email" error={errorText(f.state.meta.errors)}>
              <Input id="email" type="email" autoComplete="email" inputSize="lg" value={f.state.value} onBlur={f.handleBlur} onChange={(e) => f.handleChange(e.target.value)} aria-invalid={!!f.state.meta.errors.length} autoFocus />
            </Field>
          )}
        </form.Field>
        {!magic && (
          <form.Field name="password">
            {(f) => (
              <Field
                label={
                  <span className="flex w-full justify-between">
                    {tr('Password')}
                    <Link to="/forgot-password" className="font-normal text-ink-3 hover:text-ink">
                      {tr('Esqueceste-te?')}
                    </Link>
                  </span>
                }
                htmlFor="password"
                error={errorText(f.state.meta.errors)}
              >
                <Input id="password" type="password" autoComplete="current-password" inputSize="lg" value={f.state.value} onBlur={f.handleBlur} onChange={(e) => f.handleChange(e.target.value)} aria-invalid={!!f.state.meta.errors.length} />
              </Field>
            )}
          </form.Field>
        )}
        {error && (
          <p className="rounded-[10px] bg-bad-soft px-3 py-2 text-[13px] text-bad-ink" role="alert">
            {error}
          </p>
        )}
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(submitting) => (
            <Button type="submit" variant="primary" size="lg" loading={submitting} className="mt-1 w-full">
              {magic ? tr('Enviar link por email') : tr('Entrar')}
            </Button>
          )}
        </form.Subscribe>
        {isCloudConfigured && (
          <button type="button" className="text-[13px] text-ink-3 hover:text-ink" onClick={() => setMagic((m) => !m)}>
            {magic ? tr('Usar password') : tr('Prefiro receber um link por email')}
          </button>
        )}
        {primaryMode() === 'local' && <p className="text-[12px] text-ink-4">{tr('Modo local: as contas ficam neste browser até ligares uma base de dados.')}</p>}
      </form>
    </AuthShell>
  )
}
