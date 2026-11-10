import { createFileRoute } from '@tanstack/react-router'
import { DownloadSimpleIcon } from '@phosphor-icons/react'
import { PageShell } from '~/components/marketing/page-shell'
import { GlassRose } from '~/components/landing/rose/glass-rose'
import { Spot } from '~/components/landing/frame'
import { AppIcon, Logo, Mark } from '~/components/brand/logo'
import { msg, tr } from '~/i18n'

export const Route = createFileRoute('/brand')({
  head: () => ({ meta: [{ title: tr('Marca — Nau') }, { name: 'description', content: tr('A identidade do Nau: a rosa-dos-ventos, a luz de brasa, a tipografia e a voz.') }] }),
  component: Brand,
})

const COLORS = [
  { name: msg('Noite'), v: '#0A0A0A', note: msg('Todas as superfícies começam aqui') },
  { name: msg('Grafite'), v: '#141414', note: msg('Cartões, painéis, vidro') },
  { name: msg('Osso'), v: '#EDEDED', note: msg('Texto e ações principais') },
  { name: msg('Brasa'), v: '#FF5B1F', note: msg('Luz — nunca fundo') },
  { name: msg('Pêssego'), v: '#FFB48A', note: msg('A aresta acesa da brasa') },
  { name: msg('Erva'), v: '#46A758', note: msg('Saudável') },
  { name: msg('Âmbar'), v: '#FFC53D', note: msg('Repor') },
  { name: msg('Vermelho'), v: '#E5484D', note: msg('Esgotado') },
]

const h2 = 'text-[clamp(1.75rem,3vw,2.25rem)] leading-[1.08] font-medium tracking-[-0.03em] text-white'

function Brand() {
  return (
    <PageShell>
      <section className="mx-auto max-w-[1120px] px-5 pt-14">
        <h1 data-reveal className="max-w-[17ch] text-[clamp(2.75rem,6vw,5.25rem)] leading-[0.98] font-medium tracking-[-0.04em] text-white">
          {tr('Uma rosa-dos-ventos')} <span className="text-white/38">{tr('à volta de uma caixa.')}</span>
        </h1>
        <p data-reveal className="mt-6 max-w-[56ch] text-[17px] leading-[1.6] text-white/58">
          {tr('A nau era o navio que levava a carga de Portugal pelo mundo, guiada pela rosa-dos-ventos. A marca põe uma no centro de cada armazém: oito rumos à volta de uma caixa — direção, para aquilo que guardas.')}
        </p>
      </section>

      <section className="mx-auto mt-16 grid max-w-[1120px] gap-3 px-5 md:grid-cols-3">
        <Spot className="flex aspect-square items-center justify-center">
          <Mark size={160} className="text-white" title={tr('Marca Nau')} />
        </Spot>
        <div className="flex aspect-square items-center justify-center rounded-[22px] bg-[#ededed]">
          <Mark size={160} className="text-[#0a0a0a]" />
        </div>
        <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-[22px] bg-[#0d0d0d] shadow-[0_0_0_1px_rgb(255_255_255/0.07)]">
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-2/3 bg-[radial-gradient(60%_70%_at_50%_100%,rgb(255_91_31/0.35),transparent)]" />
          <AppIcon size={168} className="relative shadow-[0_30px_80px_-20px_rgb(0_0_0/0.9)]" />
        </div>
        <Spot className="flex items-center justify-center p-10 md:col-span-2">
          <Logo size={88} className="text-white" />
        </Spot>
        <Spot className="flex flex-col justify-between gap-6 p-6">
          <p className="text-[13.5px] leading-relaxed text-white/60">{tr('Margem mínima: a largura de um raio. Tamanho mínimo: 14 px para o símbolo, 64 px para o logótipo. O símbolo nunca roda, nunca muda de cor por categoria e nunca leva efeitos.')}</p>
          <div className="flex flex-wrap gap-2">
            {[
              [tr('Símbolo'), '/brand/nau-mark.svg'],
              ['Símbolo, branco', '/brand/nau-mark-white.svg'],
              [tr('Logótipo'), '/brand/nau-lockup.svg'],
              [tr('Ícone da app'), '/brand/nau-icon-1024.png'],
            ].map(([l, h]) => (
              <a key={h} href={h} download className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-[12.5px] text-white/85 transition-colors hover:bg-white/[0.1]">
                <DownloadSimpleIcon size={13} /> {l}
              </a>
            ))}
          </div>
        </Spot>
      </section>

      <section className="mx-auto mt-24 grid max-w-[1120px] gap-10 px-5 md:grid-cols-[1fr_1.3fr] md:items-center">
        <div data-reveal>
          <h2 className={h2}>{tr('Desenhada numa grelha de 512.')}</h2>
          <p className="mt-4 text-[15px] leading-[1.65] text-white/58">{tr('Oito raios de 42 unidades com pontas redondas, a partir do raio 92. Os cardeais chegam aos 230; os diagonais param nos 168 — o ritmo de uma rosa-dos-ventos. O centro é um quadrado de 72 unidades com cantos de 18: uma caixa vista de cima.')}</p>
        </div>
        <div data-reveal className="overflow-hidden rounded-[22px] bg-[#ededed] shadow-[0_0_0_1px_rgb(255_255_255/0.07)]">
          <img src="/brand/nau-construction.svg" alt={tr('Construção do símbolo Nau numa grelha de 512 unidades')} className="w-full" />
        </div>
      </section>

      <section className="mx-auto mt-24 max-w-[1120px] px-5">
        <h2 data-reveal className={h2}>
          {tr('Noite e osso.')} <span className="text-white/38">{tr('Uma brasa.')}</span>
        </h2>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COLORS.map((c) => (
            <div key={c.name} data-reveal className="overflow-hidden rounded-[18px] bg-[#121212] shadow-[0_0_0_1px_rgb(255_255_255/0.07)]">
              <div className="h-24 shadow-[inset_0_-1px_0_rgb(255_255_255/0.06)]" style={{ background: c.v }} />
              <div className="p-3.5">
                <div className="text-[13.5px] font-medium text-white">{tr(c.name)}</div>
                <div className="font-mono text-[11.5px] text-white/45">{c.v}</div>
                <div className="mt-1 text-[12px] text-white/50">{tr(c.note)}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[13px] text-white/45">{tr('As cores da interface vêm das escalas Radix Colors, por isso o contraste aguenta em claro e em escuro. As cores de estado têm significado e nunca são decoração.')}</p>
      </section>

      <section className="mx-auto mt-24 max-w-[1120px] px-5">
        <h2 data-reveal className={h2}>
          {tr('Luz,')} <span className="text-white/38">{tr('não tinta.')}</span>
        </h2>
        <p className="mt-4 max-w-[60ch] text-[15px] leading-[1.65] text-white/58">{tr('A cor chega como luz: um horizonte em brasa, uma aresta acesa, um brilho atrás do que importa. As superfícies ficam quase pretas e a brasa nunca é usada como fundo. No site, o símbolo é desenhado ao vivo na placa gráfica: uma peça de vidro escuro onde um feixe entra desarrumado e sai pelos oito rumos.')}</p>
        <div className="relative mt-8 aspect-[21/9] overflow-hidden rounded-[22px] shadow-[0_0_0_1px_rgb(255_255_255/0.07)]">
          <GlassRose layout="center" />
          <span className="absolute bottom-4 left-5 font-mono text-[11px] tracking-[0.06em] text-white/55 uppercase">{tr('A rosa de vidro · WebGPU (vgpu)')}</span>
        </div>
      </section>

      <section className="mx-auto mt-24 grid max-w-[1120px] gap-10 px-5 md:grid-cols-2 md:items-center">
        <div data-reveal>
          <h2 className={h2}>{tr('Uma voz para a marca, outra para o produto.')}</h2>
          <p className="mt-4 text-[15px] leading-[1.65] text-white/58">{tr('A Instrument Sans fala pela marca, com a segunda metade de cada título em cinza. Dentro do produto, tudo é Geist, com Geist Mono para horas e códigos. Os números são tabulares sempre que mudam.')}</p>
        </div>
        <Spot className="flex flex-col gap-5 p-7">
          <div className="text-[52px] leading-[0.98] font-medium tracking-[-0.04em] text-white">
            {tr('O stock que')} <span className="text-ember">{tr('se gere sozinho.')}</span>
          </div>
          <div className="text-[12px] text-white/40">{tr('Instrument Sans · 500 · −0,04 em')}</div>
          <div className="border-t border-white/[0.07] pt-5 font-sans text-[20px] font-medium tracking-[-0.02em] text-white">{tr('Repor — Quinta das Pedras')}</div>
          <div className="font-sans text-[15px] leading-[1.6] text-white/58">{tr('Dois artigos acabam antes de chegar uma nova entrega · Geist')}</div>
          <div className="mono-label text-white/45">{tr('07:12 · Receção R-418 lançada')}</div>
          <div className="tabular font-sans text-[28px] font-medium tracking-[-0.03em] text-white">8 076,78 €</div>
        </Spot>
      </section>

      <section className="mx-auto mt-24 max-w-[1120px] px-5">
        <h2 data-reveal className={h2}>
          {tr('Simples, concreta,')} <span className="text-white/38">{tr('calma.')}</span>
        </h2>
        <div className="mt-8 grid gap-3 md:grid-cols-3">
          {[
            [tr('Simples'), tr('Diz o que aconteceu e o que fazer a seguir. “O Alvarinho acaba na sexta” — não “foram detetadas oportunidades de otimização de inventário”.')],
            [tr('Concreta'), tr('Números, nomes, datas. Uma sugestão diz sempre porquê, em euros e em dias.')],
            [tr('Calma'), tr('Sem pontos de exclamação nem exageros. O produto faz o trabalho; as palavras não atrapalham.')],
          ].map(([t, b]) => (
            <Spot key={t} className="p-6">
              <h3 className="text-[16px] font-medium text-white">{t}</h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-white/55">{b}</p>
            </Spot>
          ))}
        </div>
      </section>
    </PageShell>
  )
}
