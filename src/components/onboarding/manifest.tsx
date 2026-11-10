import NumberFlow from '@number-flow/react'
import { CheckIcon } from '@phosphor-icons/react'
import { Mark } from '~/components/brand/logo'
import type { IngestReport } from '~/ingest/types'
import type { Policy, Snapshot } from '~/lib/types'
import { cn } from '~/lib/utils'
import { locale, tr } from '~/i18n'
import { date, eur as money } from '~/lib/format'

export interface Cargo {
  report: IngestReport
  after: Snapshot
  /** First and last day of the history that came in */
  from: string | null
  to: string | null
  stockValue: number
}

function Row({ label, value, sub, on }: { label: string; value: React.ReactNode; sub?: React.ReactNode; on: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line py-2.5">
      <dt className="text-[12.5px] text-ink-3">{label}</dt>
      <dd className={cn('min-w-0 text-right text-[13.5px] transition-colors duration-300', on ? 'text-ink' : 'text-ink-4')}>
        <span className="tabular font-medium">{value}</span>
        {sub && <span className="block truncate text-[11.5px] font-normal text-ink-3">{sub}</span>}
      </dd>
    </div>
  )
}

const n = (v: number) => <NumberFlow value={v} locales={locale()} />
/** Whole euros and short dates, written the way the reader's language writes them: 2 409 € · 10 out, or €2,409 · 10 Oct */
const eur = (v: number) => money(v, { decimals: 0 })
const day = (d: string) => date(d, 'short')

/**
 * The ship's manifest: what is coming aboard, filled in as the person answers.
 * It is the proof that Nau understood the files before anything is created.
 */
export function Manifest({ name, nif, sector, locations, cargo, sample, policy, step, className }: { name: string; nif: string | null; sector: string; locations: string[]; cargo: Cargo | null; sample: boolean; policy: Policy; step: number; className?: string }) {
  const r = cargo?.report
  const items = sample ? 54 : (cargo?.after.items.length ?? 0)
  const sales = sample ? 0 : (r?.documents.sales ?? 0) + (r?.documents.refunds ?? 0)
  return (
    <aside aria-label={tr('O que vai entrar no Nau')} className={cn('rounded-[18px] bg-surface p-5 shadow-card', className)}>
      <div className="flex items-center gap-3 pb-4">
        <span className="flex size-9 items-center justify-center rounded-[10px] bg-hover">
          <Mark size={17} className="text-ink" />
        </span>
        <div className="min-w-0">
          <div className={cn('truncate text-[15px] font-medium tracking-[-0.01em]', name ? 'text-ink' : 'text-ink-4')}>{name || tr('O teu negócio')}</div>
          <div className="truncate text-[12px] text-ink-3">
            {sector}
            {nif && (
              <>
                {tr('· NIF {0}', nif)} <CheckIcon size={10} weight="bold" className="inline text-ok" />
              </>
            )}
          </div>
        </div>
      </div>
      <dl>
        <Row label={tr('Artigos')} on={items > 0} value={items ? n(items) : '—'} sub={sample ? tr('dados de exemplo') : r && r.categories.created > 0 ? tr('{0} categorias', r.categories.created) : undefined} />
        <Row label={tr('Fornecedores')} on={sample || (cargo?.after.suppliers.length ?? 0) > 0} value={sample ? n(7) : cargo?.after.suppliers.length ? n(cargo.after.suppliers.length) : '—'} />
        <Row label={tr('Histórico de vendas')} on={sample || sales > 0} value={sample ? tr('90 dias') : sales ? n(sales) : '—'} sub={!sample && sales && cargo?.from && cargo.to ? tr('documentos · {0} a {1}', day(cargo.from), day(cargo.to)) : undefined} />
        <Row label={tr('Stock')} on={sample || (r?.stockSet ?? 0) > 0} value={sample ? 'incluído' : r?.stockSet ? eur(cargo!.stockValue) : '—'} sub={!sample && r?.stockSet ? tr('ao custo · {0} níveis', r.stockSet) : !sample && items > 0 && step >= 1 ? tr('por contar') : undefined} />
        <Row label={tr('Locais')} on={locations.length > 0} value={locations.length ? n(locations.length) : '—'} sub={locations.slice(0, 3).join(' · ') || undefined} />
        <Row label={tr('O Operador faz sozinho')} on={step >= 2} value={policy.reversible === 'ask' ? tr('Nada') : policy.money === 'auto' ? tr('Até {0}', eur(policy.perActionLimit)) : tr('O reversível')} sub={step >= 2 ? (policy.reversible === 'ask' ? tr('pergunta sempre') : policy.money === 'auto' ? tr('por encomenda, com registo') : tr('o dinheiro espera por ti')) : undefined} />
      </dl>
      {!sample && r && r.negative > 0 && <p className="mt-3 rounded-[10px] bg-hover px-3 py-2 text-[12px] leading-relaxed text-ink-3">{tr('Há vendas sem stock por trás. Normal quando ainda não contaste: o Nau propõe a primeira contagem assim que entrares.')}</p>}
      {!sample && r && r.lines.unmatched > 0 && <p className="mt-3 rounded-[10px] bg-hover px-3 py-2 text-[12px] leading-relaxed text-ink-3">{tr('{0} linhas não bateram com nenhum artigo e ficam de fora.', r.lines.unmatched)}</p>}
    </aside>
  )
}
