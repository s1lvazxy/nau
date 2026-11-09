import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeftIcon, ArrowRightIcon, BasketIcon, CarIcon, CoffeeIcon, FirstAidKitIcon, HammerIcon, PackageIcon, PlusIcon, ShoppingBagIcon, StorefrontIcon, TrashIcon, WarehouseIcon } from '@phosphor-icons/react'
import { Logo } from '~/components/brand/logo'
import { Button } from '~/components/ui/button'
import { Field, Input, NumberInput, Segmented } from '~/components/ui/form'
import { Manifest, type Cargo } from '~/components/onboarding/manifest'
import { SourcesStep, sourcesToBatch, type Origin, type Source, type Start } from '~/components/onboarding/sources'
import type { ConnectorId } from '~/connectors/catalog'
import { useSession } from '~/data/store'
import { applyChangeSet } from '~/data/changeset'
import { ingest } from '~/ingest/ingest'
import { tableToBatch } from '~/ingest/tabular'
import { createDemoSnapshot, createEmptySnapshot } from '~/lib/seed'
import { formatNIF, isValidNIF } from '~/lib/pt'
import type { Location, Policy, Region, Sector, Snapshot } from '~/lib/types'
import { cn, normalize, slugify, uid } from '~/lib/utils'

export const Route = createFileRoute('/onboarding')({
  ssr: false,
  head: () => ({ meta: [{ title: 'Prepara o teu espaço — Nau' }] }),
  component: Onboarding,
})

const SECTORS: { value: Sector; label: string; icon: React.ReactNode }[] = [
  { value: 'grocery', label: 'Mercearia e gourmet', icon: <BasketIcon size={20} /> },
  { value: 'cafe', label: 'Café e restauração', icon: <CoffeeIcon size={20} /> },
  { value: 'retail', label: 'Loja', icon: <ShoppingBagIcon size={20} /> },
  { value: 'pharmacy', label: 'Farmácia e saúde', icon: <FirstAidKitIcon size={20} /> },
  { value: 'hardware', label: 'Ferragens e materiais', icon: <HammerIcon size={20} /> },
  { value: 'ecommerce', label: 'Loja online', icon: <PackageIcon size={20} /> },
]
const REGIONS: { value: Region; label: string }[] = [
  { value: 'continente', label: 'Continente' },
  { value: 'madeira', label: 'Madeira' },
  { value: 'acores', label: 'Açores' },
]
const NIF_KIND = (nif: string) => (/^[123]/.test(nif) ? 'Pessoa singular' : /^5/.test(nif) ? 'Empresa' : /^6/.test(nif) ? 'Entidade pública' : /^8/.test(nif) ? 'Empresário em nome individual' : 'Entidade')

type Reach = 'ask' | 'reversible' | 'limit'
const REACH: { value: Reach; title: string; body: string }[] = [
  { value: 'ask', title: 'Pergunta sempre', body: 'O Operador prepara tudo e nada muda sem o teu sim.' },
  { value: 'reversible', title: 'Faz o que se pode desfazer', body: 'Cria artigos, rascunhos de encomenda, contagens e regras. Fica tudo no registo, com um botão para desfazer. O dinheiro espera por ti.' },
  { value: 'limit', title: 'Também encomenda, até um teto', body: 'Além disso, envia encomendas sozinho enquanto couberem no valor que definires.' },
]

const TITLES = ['Como se chama o negócio?', 'De onde vêm os teus dados?', 'Últimos acertos']

function Progress({ step }: { step: number }) {
  // The eight rays of the mark light up as the manifest fills
  const rays = [0, 45, 90, 135, 180, 225, 270, 315]
  const lit = step === 0 ? 3 : step === 1 ? 6 : 8
  return (
    <svg viewBox="0 0 512 512" width={36} height={36} aria-hidden>
      {rays.map((deg, i) => (
        <rect key={deg} x={235} y={256 - (deg % 90 === 0 ? 230 : 168)} width={42} height={(deg % 90 === 0 ? 230 : 168) - 92} rx={21} fill={i < lit ? 'var(--accent-9)' : 'var(--gray-a5)'} transform={`rotate(${deg} 256 256)`} style={{ transition: `fill 400ms ${i * 60}ms var(--ease-out)` }} />
      ))}
      <rect x={220} y={220} width={72} height={72} rx={18} fill="var(--gray-12)" />
    </svg>
  )
}

function Onboarding() {
  const navigate = useNavigate()
  const { init, status, session, backend, workspaces } = useSession()
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [sector, setSector] = useState<Sector>('grocery')
  const [nif, setNif] = useState('')
  const [region, setRegion] = useState<Region>('continente')
  const [locs, setLocs] = useState<Pick<Location, 'id' | 'name' | 'kind'>[]>([{ id: uid(), name: '', kind: 'store' }])
  const [origin, setOrigin] = useState<Origin | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [start, setStart] = useState<Start>('import')
  const [connectAfter, setConnectAfter] = useState<ConnectorId | null>(null)
  const [reach, setReach] = useState<Reach>('reversible')
  const [limit, setLimit] = useState(250)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const suggested = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => void init(), [init])
  useEffect(() => {
    if (status === 'signedOut') void navigate({ to: '/login' })
  }, [status, navigate])
  useEffect(() => {
    if (session?.mode === 'demo') void navigate({ to: '/app' })
  }, [session, navigate])
  // Each step starts at its heading, for the eye and for screen readers
  useEffect(() => {
    if (step > 0) heading.current?.focus()
    window.scrollTo({ top: 0 })
  }, [step])

  const cleanNif = nif.replace(/\D/g, '')
  const nifOk = cleanNif.length === 9 && isValidNIF(cleanNif)
  const policy: Policy = reach === 'ask' ? { reversible: 'ask', money: 'ask', outbound: 'ask', perActionLimit: 0, dailyLimit: 0 } : reach === 'limit' ? { reversible: 'auto', money: 'auto', outbound: 'ask', perActionLimit: limit, dailyLimit: limit * 3 } : { reversible: 'auto', money: 'ask', outbound: 'ask', perActionLimit: 250, dailyLimit: 750 }

  const batch = useMemo(() => (start === 'import' ? sourcesToBatch(sources) : {}), [sources, start])
  const reading = sources.some((s) => (s.kind === 'table' && s.reading) || (s.kind === 'photo' && s.status === 'reading'))
  const blocked = sources.some((s) => s.kind === 'table' && tableToBatch(s.table, s.mapping).used === 0)
  const hasData = (batch.products?.length ?? 0) + (batch.documents?.length ?? 0) + (batch.suppliers?.length ?? 0) > 0

  const base = (owner: { workspaceName: string; ownerName: string; ownerEmail: string }): Snapshot => {
    const s = createEmptySnapshot({ ...owner, sector, nif: nifOk ? cleanNif : undefined })
    const named = locs.filter((l) => l.name.trim())
    if (named.length) s.locations = named.map((l, i) => ({ id: l.id, name: l.name.trim(), code: l.name.trim().slice(0, 3).toUpperCase(), kind: l.kind, isDefault: i === 0, address: null }))
    s.workspace = { ...s.workspace, region }
    return s
  }

  // What the files turn into, computed live: the same ingest the app and the API use
  const cargo = useMemo((): Cargo | null => {
    if (!hasData) return null
    const s = base({ workspaceName: name || 'Nau', ownerName: 'Nau', ownerEmail: 'nau@example.pt' })
    const r = ingest(s, batch, { source: 'import', label: 'Importação', actor: { kind: 'user', name: 'Nau' }, setStock: true, postPurchases: true })
    const after = applyChangeSet(s, r.cs)
    const cost = new Map(after.items.map((i) => [i.id, i.cost]))
    const dates = (batch.documents ?? []).map((d) => d.date).sort()
    return { report: r.report, after, from: dates[0] ?? null, to: dates.at(-1) ?? null, stockValue: after.levels.reduce((a, l) => a + Math.max(0, l.onHand) * (cost.get(l.itemId) ?? 0), 0) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch, hasData, locs, region, sector])

  // Locations named in the files are offered once, when the person reaches that step
  useEffect(() => {
    if (step !== 2 || suggested.current) return
    suggested.current = true
    const seen = new Map<string, string>()
    for (const p of batch.products ?? []) for (const st of p.stock ?? []) if (st.location && !/^\d+$/.test(st.location)) seen.set(normalize(st.location), st.location)
    for (const d of batch.documents ?? []) if (d.location && !/^\d+$/.test(d.location)) seen.set(normalize(d.location), d.location)
    if (seen.size && locs.every((l) => !l.name.trim())) setLocs([...seen.values()].slice(0, 5).map((n) => ({ id: uid(), name: n, kind: /armaz|warehouse|stock/i.test(n) ? 'warehouse' : 'store' })))
  }, [step, batch, locs])

  const canNext = step === 0 ? name.trim().length >= 2 && (!cleanNif || nifOk) : step === 1 ? !reading && !blocked && (start !== 'import' || hasData || !!connectAfter) : locs.every((l) => l.name.trim())

  const create = async () => {
    if (!session || !backend) return
    setBusy(true)
    setError(null)
    try {
      const owner = { workspaceName: name.trim(), ownerName: session.user.name, ownerEmail: session.user.email }
      let snap = start === 'sample' ? createDemoSnapshot({ ...owner, sector, nif: nifOk ? cleanNif : undefined }) : base(owner)
      snap.workspace = { ...snap.workspace, id: uid(), name: owner.workspaceName, slug: slugify(owner.workspaceName), sector, region, nif: nifOk ? cleanNif : null, createdAt: new Date().toISOString(), settings: { ...snap.workspace.settings, policy } }
      snap.members = [{ ...snap.members[0], name: session.user.name, email: session.user.email }, ...snap.members.slice(1)]
      if (start === 'import' && hasData) {
        const r = ingest(snap, batch, { source: 'import', label: 'Importação', actor: { kind: 'user', name: session.user.name }, setStock: true, postPurchases: true })
        snap = applyChangeSet(snap, r.cs)
      }
      const id = await backend.createWorkspace(snap)
      await useSession.getState().refreshWorkspaces()
      useSession.getState().setWorkspace(id)
      if (connectAfter) void navigate({ to: '/app/integrations', search: { connect: connectAfter } as never })
      else void navigate({ to: '/app', search: { welcome: 1 } as never })
    } catch (e) {
      const m = e instanceof Error ? e.message : ''
      setError(m || 'Não foi possível criar o espaço. Tenta de novo.')
      setBusy(false)
    }
  }

  const manifest = <Manifest name={name.trim()} nif={nifOk ? formatNIF(cleanNif) : null} sector={SECTORS.find((s) => s.value === sector)?.label ?? ''} locations={locs.map((l) => l.name.trim()).filter(Boolean)} cargo={cargo} sample={start === 'sample'} policy={policy} step={step} />

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Logo size={20} />
        <div className="flex items-center gap-3 text-[12.5px] text-ink-3">
          <span className="hidden sm:inline">{session?.user.email}</span>
          {workspaces.length > 0 && (
            <button type="button" className="hover:text-ink" onClick={() => void navigate({ to: '/app' })}>
              Cancelar
            </button>
          )}
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-[1120px] flex-1 gap-x-12 gap-y-8 px-6 pt-4 pb-14 sm:px-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-4">
            <Progress step={step} />
            <div>
              <h1 ref={heading} tabIndex={-1} className="text-[clamp(1.6rem,3vw,2.125rem)] leading-tight font-medium tracking-[-0.035em] text-balance text-ink outline-none">
                {TITLES[step]}
              </h1>
              <p className="mt-1 text-[13px] text-ink-3">Passo {step + 1} de 3{step === 1 && ' · é aqui que poupas as primeiras semanas'}</p>
            </div>
          </div>

          <div className="mt-9">
            {step === 0 && (
              <div className="flex flex-col gap-7">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Nome do negócio" htmlFor="ws">
                    <Input id="ws" inputSize="lg" placeholder="Mercearia do Bairro" autoComplete="organization" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                  </Field>
                  <Field label={<>NIF <span className="font-normal text-ink-4">opcional</span></>} htmlFor="nif" hint={cleanNif ? undefined : 'Vai nas encomendas e no ficheiro para a AT.'} error={cleanNif.length === 9 && !nifOk ? 'O dígito de controlo não bate certo.' : null}>
                    <Input id="nif" inputSize="lg" inputMode="numeric" autoComplete="off" placeholder="9 dígitos" value={nif} onChange={(e) => setNif(formatNIF(e.target.value.replace(/\D/g, '').slice(0, 9)))} trailing={nifOk ? <span className="text-[12px] font-medium text-ok-ink">✓ {NIF_KIND(cleanNif)}</span> : cleanNif && cleanNif.length < 9 ? <span className="tabular text-[11.5px] text-ink-4">faltam {9 - cleanNif.length}</span> : null} />
                  </Field>
                </div>
                <div>
                  <p className="mb-2 text-[12.5px] font-medium text-ink-2">O que vendes?</p>
                  <div role="radiogroup" aria-label="Tipo de negócio" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {SECTORS.map((s) => (
                      <button key={s.value} type="button" role="radio" aria-checked={sector === s.value} onClick={() => setSector(s.value)} className={cn('press flex items-center gap-3 rounded-[14px] bg-surface p-3.5 text-left text-[13.5px] transition-shadow duration-150', sector === s.value ? 'text-ink shadow-[0_0_0_2px_var(--accent-9)]' : 'text-ink-2 shadow-card hover:text-ink')}>
                        <span className={cn('shrink-0', sector === s.value ? 'text-accent' : 'text-ink-3')}>{s.icon}</span>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Field label="Região" hint="Define as taxas de IVA que aparecem primeiro.">
                  <Segmented value={region} onChange={setRegion} options={REGIONS} />
                </Field>
              </div>
            )}

            {step === 1 && session && <SourcesStep origin={origin} setOrigin={setOrigin} sources={sources} setSources={setSources} start={start} setStart={setStart} connectAfter={connectAfter} setConnectAfter={setConnectAfter} mode={session.mode} />}

            {step === 2 && (
              <div className="flex flex-col gap-9">
                <section aria-labelledby="locs-h">
                  <h2 id="locs-h" className="text-[14px] font-medium text-ink">
                    Onde guardas stock?
                  </h2>
                  <p className="mt-0.5 text-[12.5px] text-ink-3">Uma loja chega para começar. Acrescentas armazéns e carrinhas quando quiseres.</p>
                  <div className="mt-3 flex flex-col gap-2">
                    {locs.map((l, i) => (
                      <div key={l.id} className="flex flex-col gap-2.5 rounded-[14px] bg-surface p-3 shadow-card sm:flex-row sm:items-center">
                        <Input inputSize="lg" className="flex-1" placeholder={i === 0 ? 'Loja de Alvalade' : 'Armazém'} value={l.name} onChange={(e) => setLocs(locs.map((x) => (x.id === l.id ? { ...x, name: e.target.value } : x)))} autoFocus={i === locs.length - 1 && !l.name} aria-label={`Nome do local ${i + 1}`} />
                        <Segmented
                          size="sm"
                          value={l.kind}
                          onChange={(k) => setLocs(locs.map((x) => (x.id === l.id ? { ...x, kind: k } : x)))}
                          options={[
                            { value: 'store', label: 'Loja', icon: <StorefrontIcon size={13} /> },
                            { value: 'warehouse', label: 'Armazém', icon: <WarehouseIcon size={13} /> },
                            { value: 'van', label: 'Carrinha', icon: <CarIcon size={13} /> },
                          ]}
                        />
                        {locs.length > 1 && (
                          <button type="button" aria-label={`Remover o local ${l.name || i + 1}`} onClick={() => setLocs(locs.filter((x) => x.id !== l.id))} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-bad-ink">
                            <TrashIcon size={15} />
                          </button>
                        )}
                      </div>
                    ))}
                    {locs.length < 5 && (
                      <button type="button" onClick={() => setLocs([...locs, { id: uid(), name: '', kind: 'warehouse' }])} className="flex h-11 items-center justify-center gap-2 rounded-[14px] text-[13px] text-ink-3 outline-1 -outline-offset-1 outline-[var(--gray-a6)] outline-dashed hover:text-ink">
                        <PlusIcon size={13} /> Outro local
                      </button>
                    )}
                  </div>
                </section>

                <section aria-labelledby="reach-h">
                  <h2 id="reach-h" className="text-[14px] font-medium text-ink">
                    Até onde pode o Operador ir sozinho?
                  </h2>
                  <p className="mt-0.5 text-[12.5px] text-ink-3">Mudas isto quando quiseres, no Autopiloto. Ele nunca alarga os próprios limites.</p>
                  <div role="radiogroup" aria-labelledby="reach-h" className="mt-3 flex flex-col gap-2">
                    {REACH.map((r) => {
                      const on = reach === r.value
                      return (
                        <div key={r.value} className={cn('rounded-[14px] bg-surface transition-shadow duration-150', on ? 'shadow-[0_0_0_2px_var(--accent-9)]' : 'shadow-card')}>
                          <button type="button" role="radio" aria-checked={on} onClick={() => setReach(r.value)} className="press flex w-full items-start gap-3 p-4 text-left">
                            <span className={cn('mt-[3px] flex size-4 shrink-0 items-center justify-center rounded-full transition-shadow', on ? 'shadow-[inset_0_0_0_5px_var(--accent-9)]' : 'shadow-[inset_0_0_0_1.5px_var(--gray-a8)]')} />
                            <span>
                              <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
                                {r.title}
                                {r.value === 'reversible' && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-ink">Recomendado</span>}
                              </span>
                              <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-3">{r.body}</span>
                            </span>
                          </button>
                          {on && r.value === 'limit' && (
                            <label className="flex items-center gap-3 border-t border-line px-4 py-3 text-[13px] text-ink-2">
                              Teto por encomenda
                              <NumberInput value={limit} min={0} step={50} onChange={(v) => setLimit(Math.max(0, Math.round(v)))} className="w-24" aria-label="Teto por encomenda, em euros" />
                              <span className="text-ink-3">€ · até {(limit * 3).toLocaleString('pt-PT')} € por dia</span>
                            </label>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>
              </div>
            )}
          </div>

          <div className="mt-8 lg:hidden">{manifest}</div>

          {error && (
            <p className="mt-6 rounded-[10px] bg-bad-soft px-3 py-2 text-[13px] text-bad-ink" role="alert">
              {error}
            </p>
          )}

          <div className="mt-auto flex items-center justify-between gap-3 pt-10">
            <Button variant="ghost" size="lg" onClick={() => setStep((s) => s - 1)} disabled={step === 0 || busy} icon={<ArrowLeftIcon size={14} />}>
              Voltar
            </Button>
            <div className="flex items-center gap-2">
              {step === 1 && start === 'import' && !hasData && !connectAfter && (
                <Button variant="ghost" size="lg" onClick={() => (setStart('empty'), setStep(2))}>
                  Importar depois
                </Button>
              )}
              {step < 2 ? (
                <Button variant="primary" size="lg" disabled={!canNext} loading={step === 1 && reading} onClick={() => setStep((s) => s + 1)} trailing={<ArrowRightIcon size={14} />}>
                  Continuar
                </Button>
              ) : (
                <Button variant="primary" size="lg" disabled={!canNext} loading={busy} onClick={() => void create()}>
                  {busy ? 'A carregar a bordo…' : 'Criar o espaço'}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="hidden lg:block">
          <div className="sticky top-8">
            <p className="mb-2 px-1 text-[12px] text-ink-3">Manifesto · o que vai entrar a bordo</p>
            {manifest}
          </div>
        </div>
      </main>
    </div>
  )
}
