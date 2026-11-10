import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'
import { Container, Heading, Rule, Spot } from './frame'
import { CountScene, ForecastScene, LotsScene, OrderScene, ReceiveScene, SceneDefs, StoresScene } from './scenes'
import { tr } from '~/i18n'

function Feature({ title, quiet, body, scene, className }: { title: string; quiet: string; body: string; scene: ReactNode; className?: string }) {
  return (
    <div data-reveal className={className}>
      <Spot className="group flex h-full flex-col p-2.5">
        <div className="relative h-[280px] overflow-hidden rounded-[16px] bg-[radial-gradient(120%_90%_at_50%_0%,#161616,#0c0c0c)] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)] md:h-[300px]">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(rgb(255_255_255/0.05)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:radial-gradient(70%_70%_at_50%_45%,black,transparent)]" />
          <div className="absolute inset-0 transition-transform duration-700 ease-[var(--ease-out)] group-hover:scale-[1.02]">{scene}</div>
        </div>
        <div className="px-3.5 pt-5 pb-4">
          <h3 className="text-[19px] leading-snug font-medium tracking-[-0.02em] text-white">
            {title} <span className="text-white/38">{quiet}</span>
          </h3>
          <p className="mt-1.5 max-w-[50ch] text-[14px] leading-[1.6] text-white/50">{body}</p>
        </div>
      </Spot>
    </div>
  )
}

/** What Nau does every day, one lit scene per job. */
export function Bento() {
  return (
    <section id="product" aria-labelledby="product-title" className="scroll-mt-20">
      <SceneDefs />
      <Container className="pt-28 pb-14 md:pt-36 md:pb-16">
        <Heading id="product-title" title={tr('O trabalho do armazém,')} accent="de ponta a ponta.">
          {tr('Receber, contar, prever e encomendar — com lotes, validades e várias lojas pelo meio.')}
        </Heading>
      </Container>
      <Container className="grid gap-3 pb-28 md:pb-36 lg:grid-cols-12">
        <Feature className="lg:col-span-7" title={tr('Recebe por fotografia.')} quiet={tr('As linhas entram sozinhas.')} body={tr('Fotografas a fatura. As linhas ligam-se à encomenda, os preços são comparados com a última compra e os lotes ficam registados.')} scene={<ReceiveScene />} />
        <Feature className="lg:col-span-5" title={tr('Conta com o telemóvel.')} quiet={tr('Sem papel.')} body={tr('Contagens cegas, código a código, com a diferença em unidades e em euros.')} scene={<CountScene />} />
        <Feature className="lg:col-span-5" title={tr('Prevê com o calendário.')} quiet={tr('O de cá.')} body={tr('Procura por dia da semana, feriados e Santo António — para cada artigo, em cada loja.')} scene={<ForecastScene />} />
        <Feature className="lg:col-span-7" title={tr('Encomenda num toque.')} quiet={tr('Segue por email.')} body={tr('As propostas chegam agrupadas por fornecedor, com mínimos cumpridos. Aprovas e a encomenda segue em português.')} scene={<OrderScene />} />
        <Feature className="lg:col-span-7" title={tr('Lotes e validades,')} quiet={tr('por ordem.')} body={tr('Primeiro a expirar, primeiro a sair, em todas as lojas. Antes de expirar, a remarcação já está preparada.')} scene={<LotsScene />} />
        <Feature className={cn('lg:col-span-5')} title={tr('Várias lojas,')} quiet={tr('um só stock.')} body={tr('Lojas, armazém e carrinha, com cada transferência registada de ponta a ponta.')} scene={<StoresScene />} />
      </Container>
      <Rule />
    </section>
  )
}
