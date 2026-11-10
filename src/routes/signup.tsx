import { useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { EnvelopeSimpleIcon } from '@phosphor-icons/react'
import { AuthShell, Divider, GoogleIcon } from '~/components/auth/shell'
import { errorText, useRedirectIfSignedIn } from '~/components/auth/hooks'
import { Button } from '~/components/ui/button'
import { Field, Input } from '~/components/ui/form'
import { useSession } from '~/data/store'
import { isCloudConfigured } from '~/lib/env'
import { cn } from '~/lib/utils'
import { msg, tr } from '~/i18n'

export const Route = createFileRoute('/signup')({
  head: () => ({ meta: [{ title: tr('Criar conta — Nau') }] }),
  component: Signup,
})

const schema = z.object({
  name: z.string().trim().min(2, msg('Diz-nos o teu nome')),
  email: z.email(msg('Escreve um email válido')),
  password: z.string().min(10, msg('Usa pelo menos 10 caracteres')).regex(/[A-Za-z]/, msg('Junta uma letra')).regex(/\d|[^A-Za-z0-9]/, msg('Junta um número ou símbolo')),
})

function strength(p: string) {
  let s = 0
  if (p.length >= 10) s++
  if (p.length >= 14) s++
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++
  if (/\d/.test(p)) s++
  if (/[^A-Za-z0-9]/.test(p)) s++
  return Math.min(4, s)
}

function Signup() {
  useRedirectIfSignedIn('/onboarding')
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { name: '', email: '', password: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setError(null)
      const s = useSession.getState()
      if (s.session?.mode === 'demo') await s.leaveDemo()
      try {
        const backend = useSession.getState().backend
        if (!backend) throw new Error(tr('Ainda a arrancar — tenta outra vez.'))
        const r = await backend.signUp(value)
        if (r.confirm) setConfirm(value.email)
        else void navigate({ to: '/onboarding' })
      } catch (e) {
        setError(e instanceof Error ? e.message : tr('Não foi possível criar a conta'))
      }
    },
  })
  if (confirm)
    return (
      <AuthShell title={tr('Confirma o teu email')} subtitle={tr('Enviámos um link para {0}. Abre-o neste dispositivo para criares o teu espaço de trabalho.', confirm)} footer={<Link to="/login" className="underline underline-offset-2 hover:text-ink">{tr('Voltar a entrar')}</Link>}>
        <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
          <EnvelopeSimpleIcon size={22} />
        </div>
      </AuthShell>
    )
  return (
    <AuthShell
      title={tr('Começa com o Nau')}
      subtitle={tr('Cria a conta e traz os teus dados: uma folha de cálculo, o SAF-T ou uma fotografia.')}
      palette="morning"
      footer={
        <>
          {tr('Já tens conta?')}
          <Link to="/login" className="font-medium text-ink underline-offset-2 hover:underline">
            {tr('Entrar')}
          </Link>
        </>
      }
    >
      {isCloudConfigured && (
        <>
          <Button size="lg" className="w-full" onClick={() => void useSession.getState().backend?.oauth('google').catch((e: Error) => setError(e.message))} icon={<GoogleIcon />}>
            {tr('Registar com Google')}
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
        <form.Field name="name">
          {(f) => (
            <Field label={tr('O teu nome')} htmlFor="name" error={errorText(f.state.meta.errors)}>
              <Input id="name" autoComplete="name" inputSize="lg" value={f.state.value} onBlur={f.handleBlur} onChange={(e) => f.handleChange(e.target.value)} aria-invalid={!!f.state.meta.errors.length} autoFocus />
            </Field>
          )}
        </form.Field>
        <form.Field name="email">
          {(f) => (
            <Field label={tr('Email de trabalho')} htmlFor="email" error={errorText(f.state.meta.errors)}>
              <Input id="email" type="email" autoComplete="email" inputSize="lg" value={f.state.value} onBlur={f.handleBlur} onChange={(e) => f.handleChange(e.target.value)} aria-invalid={!!f.state.meta.errors.length} />
            </Field>
          )}
        </form.Field>
        <form.Field name="password">
          {(f) => {
            const st = strength(f.state.value)
            return (
              <Field label={tr('Password')} htmlFor="password" error={errorText(f.state.meta.errors)} hint={tr('Pelo menos 10 caracteres, com um número ou símbolo.')}>
                <Input id="password" type="password" autoComplete="new-password" inputSize="lg" value={f.state.value} onBlur={f.handleBlur} onChange={(e) => f.handleChange(e.target.value)} aria-invalid={!!f.state.meta.errors.length} />
                <div className="mt-1 flex gap-1" aria-hidden>
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className={cn('h-1 flex-1 rounded-full bg-hover transition-colors duration-300', f.state.value && i < st && (st <= 1 ? 'bg-bad' : st === 2 ? 'bg-warn' : 'bg-ok'))} />
                  ))}
                </div>
              </Field>
            )
          }}
        </form.Field>
        {error && (
          <p className="rounded-[10px] bg-bad-soft px-3 py-2 text-[13px] text-bad-ink" role="alert">
            {error}
          </p>
        )}
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(submitting) => (
            <Button type="submit" variant="primary" size="lg" loading={submitting} className="mt-1 w-full">
              {tr('Criar conta')}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </AuthShell>
  )
}
