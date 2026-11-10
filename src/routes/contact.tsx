import { createFileRoute } from '@tanstack/react-router'
import { ArrowUpRightIcon } from '@phosphor-icons/react'
import { PageShell } from '~/components/marketing/page-shell'
import { Spot } from '~/components/landing/frame'
import { tr } from '~/i18n'
import { AUTHOR_URL, ISSUES_URL, SECURITY_URL } from '~/lib/site'

export const Route = createFileRoute('/contact')({
  head: () => ({ meta: [{ title: tr('Fala connosco — Nau') }] }),
  component: Contact,
})

/** There is no company inbox: Nau is an open-source project, and the conversation happens on GitHub. */
const ways = (): { title: string; body: string; label: string; to: string }[] => [
  { title: tr('Uma dúvida, uma ideia ou um erro'), body: tr('Abre uma issue no repositório. Fica à vista de quem tiver a mesma dúvida, e a resposta também.'), label: tr('Abrir uma issue'), to: ISSUES_URL },
  { title: tr('Falar com quem mantém o Nau'), body: tr('O perfil no GitHub é a forma de contacto direta.'), label: 'github.com/s1lvazxy', to: AUTHOR_URL },
  { title: tr('Uma falha de segurança'), body: tr('Usa o relatório privado do GitHub. Não abras uma issue pública.'), label: tr('Relatar em privado'), to: SECURITY_URL },
]

function Contact() {
  return (
    <PageShell>
      <div className="mx-auto grid max-w-[1120px] gap-12 px-5 pt-16 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div>
          <h1 data-reveal className="text-[clamp(2.25rem,5vw,3.75rem)] leading-[1.02] font-medium tracking-[-0.04em] text-white">
            {tr('Fala connosco')} <span className="text-white/38">{tr('pelo GitHub.')}</span>
          </h1>
          <p data-reveal className="mt-6 max-w-[42ch] text-[17px] leading-[1.6] text-white/58">
            {tr('O Nau é um projeto de código aberto. Não há uma caixa de email da empresa: as conversas acontecem onde o código vive.')}
          </p>
        </div>
        <ul className="flex flex-col gap-3">
          {ways().map((w) => (
            <li key={w.to} data-reveal>
              <Spot className="p-0">
                <a href={w.to} className="group flex items-start justify-between gap-6 p-6">
                  <span>
                    <span className="block text-[17px] font-medium tracking-[-0.01em] text-white">{w.title}</span>
                    <span className="mt-1.5 block max-w-[44ch] text-[14.5px] leading-[1.6] text-white/55">{w.body}</span>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-[14px] text-white/85 transition-colors group-hover:text-white">
                      {w.label} <ArrowUpRightIcon size={13} className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </span>
                  </span>
                </a>
              </Spot>
            </li>
          ))}
        </ul>
      </div>
    </PageShell>
  )
}
