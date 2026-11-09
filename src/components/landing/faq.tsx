import { PlusIcon } from '@phosphor-icons/react'
import { Container } from './frame'

const FAQ: [string, string][] = [
  ['O Nau é software de faturação certificado?', 'Não, e não precisa de ser. O Nau gere stock, compras e contagens. Continuas a faturar no teu programa certificado e ligas a conta (Moloni, InvoiceXpress, Vendus, Shopify, WooCommerce, Square ou SumUp, em beta) para as vendas entrarem sozinhas. Com qualquer outro programa, o ficheiro SAF-T (PT) faz o mesmo.'],
  ['A IA pode gastar dinheiro sem mim?', 'Só até ao teto que definires, e por defeito esse teto não existe. O Operador faz sozinho o que se pode desfazer: artigos, rascunhos de encomenda, contagens, regras. Fica tudo num registo, com um botão para desfazer. Enviar uma encomenda ou escrever num sistema ligado espera por ti. E ele nunca alarga os próprios limites.'],
  ['Quanto tempo demora a começar?', 'Larga a folha de cálculo ou o SAF-T do teu programa de faturação. O Nau reconhece as colunas, mostra-te o que percebeu e cria o catálogo com o histórico de vendas. A maioria das lojas fica a funcionar numa tarde. Se partes do papel, fotografa as faturas.'],
  ['O Nau é open source?', 'Sim. O código é aberto, com licença AGPL-3.0, e não há planos nem versão paga. Corre no teu computador para experimentar, ou no servidor da tua empresa com a tua base de dados. A IA usa a tua própria chave; sem ela, o Operador funciona com o motor interno.'],
  ['Preciso de leitores ou de hardware especial?', 'Não. Qualquer telemóvel recente lê códigos de barras pelo browser. Um leitor USB ou Bluetooth também funciona: escreve como um teclado.'],
  ['Onde ficam os meus dados?', 'Onde tu decidires. Em modo local, no teu browser. Numa instalação, na tua base de dados Postgres, com segurança ao nível da linha: cada espaço de trabalho só vê as suas próprias linhas. Exportas tudo em CSV quando quiseres.'],
  ['O meu contabilista pode ter acesso?', 'Sim. Convida-o como Leitor: vê a valorização do stock e os movimentos e pode exportar o ficheiro de inventário da AT, mas não altera nada.'],
]

/** A quiet column: questions, hairlines, nothing else. */
export function Faq() {
  return (
    <section aria-labelledby="faq-title">
      <Container className="py-28 md:py-40">
        <div className="mx-auto max-w-[760px]">
          <h2 id="faq-title" data-lines className="text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.08] font-medium tracking-[-0.03em] text-white">
            Perguntas de quem <span className="text-white/38">gere uma loja.</span>
          </h2>
          <div data-reveal className="mt-10 border-t border-white/[0.09]">
            {FAQ.map(([q, a]) => (
              <details key={q} className="faq group border-b border-white/[0.09]">
                <summary className="flex cursor-default list-none items-center justify-between gap-6 py-6 text-[17px] font-medium tracking-[-0.01em] text-white/85 transition-colors duration-200 hover:text-white [&::-webkit-details-marker]:hidden">
                  {q}
                  <PlusIcon size={15} className="shrink-0 text-white/45 transition-transform duration-300 ease-[var(--ease-out)] group-open:rotate-45" />
                </summary>
                <p className="max-w-[60ch] pb-7 text-[15.5px] leading-[1.65] text-white/55">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </Container>
    </section>
  )
}
