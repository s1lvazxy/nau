import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Logo, Mark } from '~/components/brand/logo'
import { GlassRose } from '~/components/landing/rose/glass-rose'
import { LangSwitch } from '~/components/lang-switch'
import { locale, tr } from '~/i18n'
import { home } from '~/lib/site'

export function AuthShell({ title, subtitle, children, footer, palette = 'dawn' }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; palette?: 'dawn' | 'dusk' | 'morning' }) {
  return (
    <div lang={locale()} className="dark grid min-h-dvh bg-[#0a0a0a] text-ink lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]" style={{ colorScheme: 'dark' }}>
      <div className="flex flex-col px-6 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <a href={home()} className="w-fit" aria-label={tr('Nau — início')}>
            <Logo size={20} />
          </a>
          <LangSwitch />
        </div>
        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-[360px]">
            <h1 className="font-display text-[30px] leading-tight font-medium tracking-[-0.035em] text-ink">{title}</h1>
            {subtitle && <p className="mt-1.5 text-[14px] leading-relaxed text-ink-3">{subtitle}</p>}
            <div className="mt-8">{children}</div>
            {footer && <div className="mt-8 text-[13px] text-ink-3">{footer}</div>}
          </div>
        </div>
        <p className="text-[12px] text-ink-4">
          {tr('Ao continuar, aceitas os')}
          <Link to="/legal/$doc" params={{ doc: 'terms' }} className="underline underline-offset-2 hover:text-ink-2">
            {tr('Termos')}
          </Link>{' '}
          e a{' '}
          <Link to="/legal/$doc" params={{ doc: 'privacy' }} className="underline underline-offset-2 hover:text-ink-2">
            {tr('Política de privacidade')}
          </Link>
          .
        </p>
      </div>
      <div className="relative m-3 hidden overflow-hidden rounded-[28px] shadow-[0_0_0_1px_rgb(255_255_255/0.07)] lg:block" data-palette={palette}>
        <GlassRose layout="panel" />
        <div className="absolute inset-0 flex flex-col justify-end p-10">
          <div className="max-w-[420px] rounded-[20px] bg-[#141414]/72 p-5 shadow-[0_0_0_1px_rgb(255_255_255/0.09),inset_0_1px_0_rgb(255_255_255/0.06),0_40px_90px_-24px_rgb(0_0_0/0.95)] backdrop-blur-2xl">
            <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
              <Mark size={14} /> {tr('Resumo da manhã · 07:30')}
            </div>
            <p className="mt-3 text-[18px] leading-snug font-medium tracking-[-0.02em] text-ink">{tr('Bom dia. As vendas subiram 8% face à semana passada — e há duas encomendas prontas para ti.')}</p>
            <ul className="mt-4 flex flex-col gap-2 text-[13px] text-ink-3">
              <li className="flex gap-2">
                <span className="mt-1.5 size-1.5 rounded-full bg-[var(--amber-9)]" />
                {tr('O Alvarinho acaba na sexta, antes do Santo António.')}
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 size-1.5 rounded-full bg-[var(--grass-9)]" />
                {tr('Cápsulas reequilibradas para o Príncipe Real durante a noite.')}
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 size-1.5 rounded-full bg-[var(--blue-9)]" />
                {tr('A Torrefação Lusa entrega hoje antes das 11:00.')}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="my-5 flex items-center gap-3 text-[12px] text-ink-4">
      <span className="h-px flex-1 bg-line" />
      {children}
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

export function GoogleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}
