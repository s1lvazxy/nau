import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { PageShell } from '~/components/marketing/page-shell'
import { Button } from '~/components/ui/button'
import { Field, Input, Select, Textarea } from '~/components/ui/form'
import { Spot } from '~/components/landing/frame'

export const Route = createFileRoute('/contact')({
  head: () => ({ meta: [{ title: 'Fala connosco — Nau' }] }),
  component: Contact,
})

function Contact() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [topic, setTopic] = useState('business')
  const [message, setMessage] = useState('')
  const ok = name.trim() && /^\S+@\S+\.\S+$/.test(email) && message.trim().length > 5
  const send = () => {
    const subject = `[${topic}] ${company || name}`
    const body = `${message}\n\n— ${name}${company ? `, ${company}` : ''}\n${email}`
    window.location.href = `mailto:hello@nau.pt?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }
  return (
    <PageShell>
      <div className="mx-auto grid max-w-[1120px] gap-12 px-5 pt-16 md:grid-cols-2">
        <div>
          <h1 data-reveal className="text-[clamp(2.25rem,5vw,3.75rem)] leading-[1.02] font-medium tracking-[-0.04em] text-white">
            Fala com <span className="text-white/38">uma pessoa.</span>
          </h1>
          <p data-reveal className="mt-6 max-w-[42ch] text-[17px] leading-[1.6] text-white/58">Várias lojas, um negócio grossista ou um catálogo noutro sistema? Ajudamos-te a mudar para o Nau.</p>
          <dl className="mt-10 grid gap-6 text-[14px]">
            <div>
              <dt className="mono-label text-ink-3">Email</dt>
              <dd className="mt-1 text-ink">hello@nau.pt</dd>
            </div>
            <div>
              <dt className="mono-label text-ink-3">Horário</dt>
              <dd className="mt-1 text-ink">Dias úteis, 9:00–18:00 (Lisboa)</dd>
            </div>
          </dl>
        </div>
        <Spot className="p-6 font-sans">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (ok) send()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </Field>
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </Field>
          </div>
          <Field label="Empresa" optional>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" />
          </Field>
          <Field label="Assunto">
            <Select
              value={topic}
              onChange={setTopic}
              options={[
                { value: 'business', label: 'Plano Business' },
                { value: 'migration', label: 'Mudar de outro sistema' },
                { value: 'support', label: 'Ajuda com o meu espaço' },
                { value: 'press', label: 'Imprensa e parcerias' },
              ]}
            />
          </Field>
          <Field label="Mensagem">
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} placeholder="Quantos locais e artigos, e o que usas hoje?" />
          </Field>
          <Button type="submit" variant="primary" size="lg" disabled={!ok}>
            Enviar
          </Button>
          <p className="text-[12px] text-ink-4">Abre a tua app de email com a mensagem pronta.</p>
        </form>
        </Spot>
      </div>
    </PageShell>
  )
}
