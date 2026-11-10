import { num } from '~/lib/format'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CameraIcon, CaretDownIcon, CheckIcon, DatabaseIcon, NotePencilIcon, PlugsConnectedIcon, ReceiptIcon, SparkleIcon, SquareIcon, TableIcon, UploadSimpleIcon, WarningIcon, XIcon } from '@phosphor-icons/react'
import { accessToken } from '~/agent/operator'
import { Spinner } from '~/components/ui/button'
import { Select } from '~/components/ui/form'
import { Mark } from '~/components/brand/logo'
import { CONNECTORS, type ConnectorId } from '~/connectors/catalog'
import { fileToBase64, readFile } from '~/ingest/files'
import type { SaftSummary } from '~/ingest/saft'
import { FIELD_LABEL, FIELDS, guessMapping, KIND_LABEL, mergeBatches, SHEET_KINDS, tableToBatch, type Field, type Mapping, type SheetKind, type Table } from '~/ingest/tabular'
import type { IngestBatch } from '~/ingest/types'
import type { Session } from '~/lib/types'
import { cn, uid } from '~/lib/utils'
import { tr } from '~/i18n'

export type Origin = 'sheet' | 'invoicing' | 'system' | 'paper'
export type Start = 'import' | 'sample' | 'empty'

export type Source =
  | { id: string; kind: 'table'; name: string; table: Table; mapping: Mapping; reading: boolean; byModel: boolean }
  | { id: string; kind: 'saft'; name: string; summary: SaftSummary }
  | { id: string; kind: 'photo'; name: string; mode: 'invoice' | 'shelf'; status: 'reading' | 'done' | 'error'; error?: string; batch?: IngestBatch; found?: number }
  | { id: string; kind: 'error'; name: string; error: string }

export function sourcesToBatch(sources: Source[]): IngestBatch {
  return mergeBatches(
    ...sources.map((s): IngestBatch => {
      if (s.kind === 'table') return tableToBatch(s.table, s.mapping).batch
      if (s.kind === 'saft') return s.summary.batch
      if (s.kind === 'photo') return s.batch ?? {}
      return {}
    }),
  )
}

const ORIGINS: { value: Origin; title: string; body: string; icon: React.ReactNode }[] = [
  { value: 'sheet', title: tr('Excel ou folha de cálculo'), body: tr('Larga o ficheiro como está. O Nau percebe as colunas.'), icon: <TableIcon size={20} /> },
  { value: 'invoicing', title: tr('Software de faturação'), body: tr('O SAF-T traz artigos, preços e todas as vendas. Ou liga a conta.'), icon: <ReceiptIcon size={20} /> },
  { value: 'system', title: tr('Outro sistema de stock'), body: tr('Artigos, stock por local, lotes, fornecedores e histórico.'), icon: <DatabaseIcon size={20} /> },
  { value: 'paper', title: tr('Papel, ou nada'), body: tr('Fotografa faturas e prateleiras, ou começa do zero.'), icon: <NotePencilIcon size={20} /> },
]

const ACCEPT: Record<Origin, string> = { sheet: '.xlsx,.csv,.txt,.tsv', invoicing: '.xml,.xlsx,.csv', system: '.xlsx,.csv,.txt,.tsv,.xml', paper: 'image/*,.pdf' }
const DROP_HINT: Record<Origin, string> = {
  sheet: tr('Excel (.xlsx) ou CSV. Vários ficheiros de uma vez, se quiseres.'),
  invoicing: tr('O SAF-T (PT) em .xml. Em quase todos os programas está em Exportar → SAF-T.'),
  system: tr('Uma exportação por tabela: artigos, stock, fornecedores, vendas, compras. Excel, CSV ou SAF-T.'),
  paper: '',
}

async function modelHeaders(mode: Session['mode']) {
  const token = mode === 'cloud' ? await accessToken() : null
  return { 'content-type': 'application/json', 'x-nau-mode': mode, ...(token ? { authorization: `Bearer ${token}` } : {}) }
}

export function SourcesStep({ origin, setOrigin, sources, setSources, start, setStart, connectAfter, setConnectAfter, mode }: { origin: Origin | null; setOrigin: (o: Origin) => void; sources: Source[]; setSources: React.Dispatch<React.SetStateAction<Source[]>>; start: Start; setStart: (s: Start) => void; connectAfter: ConnectorId | null; setConnectAfter: (c: ConnectorId | null) => void; mode: Session['mode'] }) {
  const [over, setOver] = useState(false)
  const [model, setModel] = useState<boolean | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const photoMode = useRef<'invoice' | 'shelf'>('invoice')
  const patch = useCallback((id: string, next: Partial<Source>) => setSources((list) => list.map((s) => (s.id === id ? ({ ...s, ...next } as Source) : s))), [setSources])

  useEffect(() => {
    fetch(`/api/agent?mode=${mode}`)
      .then((r) => r.json())
      .then((j: { enabled: boolean }) => setModel(!!j.enabled))
      .catch(() => setModel(false))
  }, [mode])

  /** The built-in reading is instant; when the model is there it takes a second look at unusual columns. */
  const refine = useCallback(
    async (added: Extract<Source, { kind: 'table' }>[]) => {
      try {
        const res = await fetch('/api/import/map', { method: 'POST', headers: await modelHeaders(mode), body: JSON.stringify({ tables: added.map((s) => ({ name: s.table.name, headers: s.table.headers, sample: s.table.rows.slice(0, 6) })) }) })
        if (!res.ok) throw new Error()
        const out = (await res.json()) as { tables: { kind: SheetKind; columns: { header: string; field: Field | null }[]; price_includes_vat: boolean }[] }
        added.forEach((s, i) => {
          const t = out.tables[i]
          const columns: Record<string, Field | null> = Object.fromEntries(s.table.headers.map((h) => [h, null]))
          const used = new Set<Field>()
          for (const c of t.columns) if (c.header in columns && c.field && !used.has(c.field)) (columns[c.header] = c.field), used.add(c.field)
          patch(s.id, { mapping: { kind: t.kind, columns, priceIncludesVat: t.price_includes_vat }, reading: false, byModel: true })
        })
      } catch {
        added.forEach((s) => patch(s.id, { reading: false }))
      }
    },
    [mode, patch],
  )

  const readPhoto = useCallback(
    async (id: string, file: File, as: 'invoice' | 'shelf') => {
      try {
        const mediaType = file.type === 'application/pdf' ? 'application/pdf' : file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
        const res = await fetch('/api/extract', { method: 'POST', headers: await modelHeaders(mode), body: JSON.stringify({ mode: as, data: await fileToBase64(file), mediaType, catalogue: [] }) })
        const j = await res.json()
        if (!res.ok) throw new Error(res.status === 401 ? tr('Entra na tua conta para ler fotografias.') : tr('Não conseguimos ler esta fotografia. Tenta uma mais nítida, tirada de frente.'))
        if (as === 'shelf') {
          const products = (j.products as { name: string; category: string | null; barcode: string | null; count: number }[]).map((p, i) => ({ ref: `shelf:${id}:${i}`, name: p.name, category: p.category, barcode: p.barcode, stock: [{ qty: Math.max(0, Math.round(p.count)) }] }))
          patch(id, { status: 'done', batch: { products }, found: products.length })
        } else {
          const lines = (j.lines as { description: string; code: string | null; qty: number; unit_cost: number; lot: string | null; expires_on: string | null }[]).filter((l) => l.description && l.qty > 0)
          const ref = `${j.supplier_nif ?? j.supplier_name ?? 'doc'}:${j.document_number ?? id}`
          patch(id, { status: 'done', found: lines.length, batch: { documents: lines.length ? [{ ref, kind: 'purchase', number: j.document_number ?? file.name, date: j.document_date ?? new Date().toISOString().slice(0, 10), party: j.supplier_name ? { name: j.supplier_name, nif: j.supplier_nif } : null, lines: lines.map((l) => ({ sku: l.code, name: l.description, qty: l.qty, unitCost: l.unit_cost, lot: l.lot, expiresOn: l.expires_on })) }] : [] } })
        }
      } catch (e) {
        patch(id, { status: 'error', error: e instanceof Error ? e.message : tr('Não conseguimos ler esta fotografia.') })
      }
    },
    [mode, patch],
  )

  const add = useCallback(
    async (files: FileList | File[], as?: 'invoice' | 'shelf') => {
      setStart('import')
      const tables: Extract<Source, { kind: 'table' }>[] = []
      for (const f of Array.from(files).slice(0, 12)) {
        const r = await readFile(f)
        if (r.kind === 'tables') for (const table of r.tables) tables.push({ id: uid(), kind: 'table', name: table.name, table, mapping: guessMapping(table), reading: model === true, byModel: false })
        else if (r.kind === 'saft') setSources((l) => [...l, { id: uid(), kind: 'saft', name: r.name, summary: r.summary }])
        else if (r.kind === 'photo') {
          const id = uid()
          const pm = as ?? photoMode.current
          setSources((l) => [...l, { id, kind: 'photo', name: r.name, mode: pm, status: model === false ? 'error' : 'reading', error: model === false ? tr('Ler fotografias precisa do modelo de IA, que não está ligado nesta instalação.') : undefined }])
          if (model !== false) void readPhoto(id, r.file, pm)
        } else setSources((l) => [...l, { id: uid(), kind: 'error', name: r.name, error: r.error }])
      }
      if (tables.length) {
        setSources((l) => [...l, ...tables])
        if (model) void refine(tables)
      }
    },
    [model, readPhoto, refine, setSources, setStart],
  )

  const remove = (id: string) => setSources((l) => l.filter((s) => s.id !== id))
  const accounts = CONNECTORS.filter((c) => c.status === 'beta')

  return (
    <div className="flex flex-col gap-5">
      <div role="radiogroup" aria-label={tr('De onde vêm os teus dados')} className="grid gap-2 sm:grid-cols-2">
        {ORIGINS.map((o) => {
          const on = origin === o.value
          return (
            <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => setOrigin(o.value)} className={cn('press flex items-start gap-3.5 rounded-[14px] bg-surface p-4 text-left transition-shadow duration-150', on ? 'shadow-[0_0_0_2px_var(--accent-9)]' : 'shadow-card hover:shadow-[0_0_0_1px_var(--gray-a7)]')}>
              <span className={cn('mt-0.5 shrink-0 transition-colors', on ? 'text-accent' : 'text-ink-3')}>{o.icon}</span>
              <span>
                <span className="block text-[14px] font-medium text-ink">{o.title}</span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">{o.body}</span>
              </span>
            </button>
          )
        })}
      </div>

      {origin && origin !== 'paper' && (
        <div
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => (e.preventDefault(), setOver(false), void add(e.dataTransfer.files))}
          className={cn('flex flex-col items-center rounded-[16px] text-center transition-[background-color,padding] duration-200 ease-[var(--ease-out)]', sources.length ? 'gap-1 px-5 py-4' : 'gap-2 px-6 py-8', over ? 'bg-accent-soft outline-[1.5px] -outline-offset-1 outline-[var(--accent-9)] outline-solid' : 'outline-1 -outline-offset-1 outline-[var(--gray-a7)] outline-dashed')}
          style={over ? undefined : { backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 9px, var(--gray-a2) 9px 10px)' }}
        >
          {!sources.length && <UploadSimpleIcon size={22} className={over ? 'text-accent' : 'text-ink-3'} />}
          <p className={cn('font-medium text-ink', sources.length ? 'text-[13px]' : 'text-[14px]')}>
            {sources.length ? tr('Larga mais ficheiros, ou') : tr('Larga aqui os ficheiros, ou')}{' '}
            <button type="button" onClick={() => fileRef.current?.click()} className="text-accent-ink underline decoration-[var(--accent-a7)] underline-offset-[3px] hover:decoration-current">
              {tr('escolhe do computador')}
            </button>
          </p>
          {!sources.length && <p className="max-w-[46ch] text-[12.5px] leading-relaxed text-ink-3">{DROP_HINT[origin]}</p>}
          <p className="text-[11.5px] text-ink-4">{tr('Os ficheiros são lidos no teu browser. Nada é enviado até criares o espaço.')}</p>
          <input ref={fileRef} type="file" multiple accept={ACCEPT[origin]} className="hidden" onChange={(e) => (e.target.files && void add(e.target.files), (e.target.value = ''))} />
        </div>
      )}

      {origin === 'paper' && (
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              { key: 'invoice', title: tr('Fotografar faturas e guias'), body: tr('Cada linha vira um artigo, com custo, fornecedor e a quantidade que entrou.'), icon: <ReceiptIcon size={18} /> },
              { key: 'shelf', title: tr('Fotografar prateleiras'), body: tr('O Nau lê os rótulos e conta o que está à vista. Tu confirmas depois.'), icon: <CameraIcon size={18} /> },
            ] as const
          ).map((p) => (
            <button key={p.key} type="button" disabled={model === false} onClick={() => ((photoMode.current = p.key), photoRef.current?.click())} className="press flex items-start gap-3 rounded-[14px] bg-surface p-4 text-left shadow-card transition-shadow hover:shadow-[0_0_0_1px_var(--gray-a7)] disabled:pointer-events-none disabled:opacity-50">
              <span className="mt-0.5 text-ink-3">{p.icon}</span>
              <span>
                <span className="block text-[13.5px] font-medium text-ink">{p.title}</span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">{p.body}</span>
              </span>
            </button>
          ))}
          <input ref={photoRef} type="file" multiple accept="image/*,.pdf" capture="environment" className="hidden" onChange={(e) => (e.target.files && void add(e.target.files, photoMode.current), (e.target.value = ''))} />
          {model === false && <p className="text-[12.5px] text-ink-3 sm:col-span-2">{tr('Ler fotografias precisa do modelo de IA, que não está ligado nesta instalação. Podes começar vazio e dar entrada das faturas à mão.')}</p>}
          {(
            [
              { v: 'sample', title: tr('Ver primeiro com dados de exemplo'), body: tr('Uma mercearia com 54 artigos e 90 dias de vendas. Apagas quando quiseres.'), icon: <SparkleIcon size={18} /> },
              { v: 'empty', title: tr('Começar vazio'), body: tr('Crias os artigos à medida que as entregas chegam.'), icon: <SquareIcon size={18} /> },
            ] as const
          ).map((o) => (
            <button key={o.v} type="button" aria-pressed={start === o.v} onClick={() => setStart(start === o.v ? 'import' : o.v)} className={cn('press flex items-start gap-3 rounded-[14px] bg-surface p-4 text-left transition-shadow', start === o.v ? 'shadow-[0_0_0_2px_var(--accent-9)]' : 'shadow-card hover:shadow-[0_0_0_1px_var(--gray-a7)]')}>
              <span className={cn('mt-0.5', start === o.v ? 'text-accent' : 'text-ink-3')}>{o.icon}</span>
              <span>
                <span className="block text-[13.5px] font-medium text-ink">{o.title}</span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">{o.body}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {sources.length > 0 && (
        <ul className="flex flex-col gap-2">
          {sources.map((s) => (
            <li key={s.id} className="starting:translate-y-1 starting:opacity-0 transition-[opacity,translate] duration-300 ease-[var(--ease-out)]">
              {s.kind === 'table' ? <TableCard s={s} onChange={(next) => patch(s.id, next)} onRemove={() => remove(s.id)} /> : <FileRow s={s} onRemove={() => remove(s.id)} />}
            </li>
          ))}
        </ul>
      )}

      {origin === 'invoicing' && (
        <div className="rounded-[14px] bg-surface p-4 shadow-card">
          <div className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
            <PlugsConnectedIcon size={16} className="text-ink-3" /> {tr('Ou liga a conta, e as vendas passam a entrar sozinhas')}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {accounts.map((c) => (
              <button key={c.id} type="button" disabled={mode !== 'cloud'} aria-pressed={connectAfter === c.id} onClick={() => setConnectAfter(connectAfter === c.id ? null : c.id)} className={cn('press inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] transition-colors disabled:pointer-events-none disabled:opacity-45', connectAfter === c.id ? 'bg-ink font-medium text-inverse' : 'bg-hover text-ink-2 hover:text-ink')}>
                {connectAfter === c.id && <CheckIcon size={11} weight="bold" />}
                {c.name}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
            {mode !== 'cloud'
              ? tr('As ligações precisam da base de dados da instalação (Supabase). Neste modo local, usa o SAF-T.')
              : connectAfter
                ? tr('Pedimos as credenciais do {0} logo a seguir a criares o espaço. A primeira sincronização traz os artigos e 90 dias de vendas.', accounts.find((c) => c.id === connectAfter)?.name)
                : tr('TOConline, Zone Soft, WinRest e os restantes programas certificados entram pelo SAF-T.')}
          </p>
        </div>
      )}
    </div>
  )
}

function FileRow({ s, onRemove }: { s: Exclude<Source, { kind: 'table' }>; onRemove: () => void }) {
  const bad = s.kind === 'error' || (s.kind === 'photo' && s.status === 'error')
  return (
    <div className="flex items-start gap-3 rounded-[14px] bg-surface p-3.5 shadow-card">
      <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[9px]', bad ? 'bg-bad-soft text-bad-ink' : 'bg-hover text-ink-2')}>{bad ? <WarningIcon size={15} /> : s.kind === 'saft' ? <ReceiptIcon size={15} /> : s.kind === 'photo' && s.status === 'reading' ? <Spinner className="size-3.5" /> : <CameraIcon size={15} />}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium text-ink">{s.name}</div>
        <div className="mt-0.5 text-[12.5px] leading-snug text-ink-3">
          {s.kind === 'error' && s.error}
          {s.kind === 'saft' && (
            <>
              {tr('SAF-T de {0}{1} ·', s.summary.company || tr('empresa sem nome'), s.summary.period && ` · ${s.summary.period}`)} <span className="tabular text-ink-2">{s.summary.products}</span> {tr('artigos ·')} <span className="tabular text-ink-2">{s.summary.batch.documents?.length ?? 0}</span> {tr('documentos de venda')}
            </>
          )}
          {s.kind === 'photo' && (s.status === 'reading' ? (s.mode === 'shelf' ? tr('A ler os rótulos e a contar…') : tr('A ler as linhas da fatura…')) : s.status === 'error' ? s.error : s.mode === 'shelf' ? tr('{0} produtos contados à vista. Confirma as quantidades depois, numa contagem.', s.found) : s.found ? tr('{0} linhas lidas. Entram como entrega, com os custos da fatura.', s.found) : tr('Não encontrámos linhas de artigos nesta página.'))}
        </div>
      </div>
      <button type="button" aria-label={tr('Retirar {0}', s.name)} onClick={onRemove} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink">
        <XIcon size={14} />
      </button>
    </div>
  )
}

const FIELD_OPTIONS = [{ value: '', label: tr('Ignorar') }, ...FIELDS.map((f) => ({ value: f as string, label: FIELD_LABEL[f] }))]
/** Fields that only make sense for one kind of sheet are left out of the other's list. */
const HIDDEN: Record<SheetKind, Field[]> = { items: ['qty', 'date', 'doc', 'nif', 'email', 'phone'], suppliers: ['sku', 'barcode', 'category', 'unit', 'cost', 'price', 'vat', 'stock', 'location', 'lot', 'expiry', 'qty', 'date', 'doc'], sales: ['stock', 'category', 'unit', 'nif', 'email', 'phone', 'supplier'], purchases: ['stock', 'category', 'unit', 'email', 'phone'] }

function TableCard({ s, onChange, onRemove }: { s: Extract<Source, { kind: 'table' }>; onChange: (next: Partial<Extract<Source, { kind: 'table' }>>) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false)
  const { issues, used } = tableToBatch(s.table, s.mapping)
  const mapped = Object.values(s.mapping.columns).filter(Boolean).length
  const need: Field[] = s.mapping.kind === 'suppliers' ? ['name'] : s.mapping.kind === 'items' ? ['name'] : ['date', 'qty']
  const missing = need.filter((f) => !Object.values(s.mapping.columns).includes(f))
  const setField = (header: string, field: Field | null) => {
    const columns = { ...s.mapping.columns }
    // A field belongs to one column: taking it here frees it there
    if (field) for (const h of Object.keys(columns)) if (columns[h] === field) columns[h] = null
    columns[header] = field
    onChange({ mapping: { ...s.mapping, columns } })
  }
  return (
    <div className="overflow-hidden rounded-[14px] bg-surface shadow-card">
      <div className="flex items-start gap-3 p-3.5">
        <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[9px]', missing.length ? 'bg-bad-soft text-bad-ink' : 'bg-hover text-ink-2')}>{s.reading ? <Mark size={14} working /> : missing.length ? <WarningIcon size={15} /> : <TableIcon size={15} />}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-ink">{s.name}</div>
          <div className="mt-0.5 text-[12.5px] leading-snug text-ink-3">
            {s.reading ? (
              tr('O Operador está a ler as colunas…')
            ) : missing.length ? (
              <span className="text-bad-ink">{tr('Falta indicar a coluna de {0}.', missing.map((f) => FIELD_LABEL[f].toLowerCase()).join(' e de '))}</span>
            ) : (
              <>
                <span className="tabular text-ink-2">{num(used)}</span> {(s.byModel ? tr('de {0} linhas · {1} de {2} colunas reconhecidas pelo Operador', s.table.rows.length.toLocaleString('pt-PT'), mapped, s.table.headers.length) : tr('de {0} linhas · {1} de {2} colunas reconhecidas', s.table.rows.length.toLocaleString('pt-PT'), mapped, s.table.headers.length))}
                {issues.length > 0 && <span className="text-warn-ink"> {tr('· {0} por rever', issues.length)}</span>}
              </>
            )}
          </div>
        </div>
        <Select size="sm" aria-label={tr('O que este ficheiro contém')} className="w-[168px] shrink-0 max-sm:hidden" value={s.mapping.kind} onChange={(kind: SheetKind) => onChange({ mapping: { ...guessMapping(s.table), kind } })} options={SHEET_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        <button type="button" aria-label={tr('Retirar {0}', s.name)} onClick={onRemove} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink">
          <XIcon size={14} />
        </button>
      </div>
      <button type="button" aria-expanded={open || missing.length > 0} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1.5 border-t border-line px-3.5 py-2 text-left text-[12.5px] text-ink-3 hover:text-ink">
        <CaretDownIcon size={11} className={cn('transition-transform duration-200', (open || missing.length > 0) && 'rotate-180')} />
        {open || missing.length > 0 ? tr('Colunas') : tr('Ver e corrigir as colunas')}
        <span className="ml-auto sm:hidden">{KIND_LABEL[s.mapping.kind]}</span>
      </button>
      {(open || missing.length > 0) && (
        <div className="border-t border-line">
          <div className="max-h-[320px] overflow-y-auto">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-surface text-ink-3">
                <tr>
                  <th className="px-3.5 py-2 text-left font-normal">{tr('Coluna no ficheiro')}</th>
                  <th className="px-2 py-2 text-left font-normal max-sm:hidden">{tr('Exemplo')}</th>
                  <th className="w-[190px] px-3.5 py-2 text-left font-normal">{tr('No Nau')}</th>
                </tr>
              </thead>
              <tbody>
                {s.table.headers.map((h) => (
                  <tr key={h} className="border-t border-line">
                    <td className="max-w-[180px] truncate px-3.5 py-1.5 text-ink">{h}</td>
                    <td className="max-w-[160px] truncate px-2 py-1.5 text-ink-3 max-sm:hidden">{s.table.rows.find((r) => r[h])?.[h] ?? '—'}</td>
                    <td className="px-3.5 py-1.5">
                      <Select size="sm" aria-label={tr('Campo para a coluna {0}', h)} value={s.mapping.columns[h] ?? ''} onChange={(v: string) => setField(h, (v || null) as Field | null)} options={FIELD_OPTIONS.filter((o) => !HIDDEN[s.mapping.kind].includes(o.value as Field))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s.mapping.kind !== 'suppliers' && Object.values(s.mapping.columns).includes('price') && (
            <label className="flex items-center gap-2 border-t border-line px-3.5 py-2.5 text-[12.5px] text-ink-2">
              <input type="checkbox" className="accent-[var(--accent-9)]" checked={s.mapping.priceIncludesVat} onChange={(e) => onChange({ mapping: { ...s.mapping, priceIncludesVat: e.target.checked } })} />
              {tr('Os preços de venda já incluem IVA')}
            </label>
          )}
          {issues.length > 0 && (
            <ul className="border-t border-line px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-3">
              {issues.slice(0, 4).map((i) => (
                <li key={`${i.row}${i.message}`}>
                  {tr('Linha {0}: {1}', i.row, i.message)}
                </li>
              ))}
              {issues.length > 4 && <li>{tr('e mais {0}. Estas linhas ficam de fora.', issues.length - 4)}</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
