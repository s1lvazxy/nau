import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CopyIcon, DownloadSimpleIcon, EnvelopeSimpleIcon, LinkIcon, TrashIcon } from '@phosphor-icons/react'
import { snapshotKey, useSession, useSnapshot } from '~/data/store'
import { resetDemo } from '~/data/local'
import { useMail } from '~/data/mail'
import { useOperator } from '~/agent/operator'
import { useUI } from '~/stores/ui'
import { formatNIF, isValidNIF, nifKind, REGION_LABEL } from '~/lib/pt'
import { cn, downloadFile, hashString, uid } from '~/lib/utils'
import type { Accent, Member, Region, Role, Sector } from '~/lib/types'
import { Button } from '~/components/ui/button'
import { Field, Input, Segmented, Select, Switch } from '~/components/ui/form'
import { Modal } from '~/components/ui/overlay'
import { Avatar, Badge, Card, PageHeader } from '~/components/ui/primitives'
import { useActions } from '~/components/app/actions'
import { usePageTitle } from '~/components/app/page'
import { useNavEntries } from '~/components/app/sidebar'
import { Mark } from '~/components/brand/logo'
import { LANGS, currentLang, setLang, tr, type Lang } from '~/i18n'

type Tab = 'workspace' | 'team' | 'appearance' | 'operator' | 'data'

export const Route = createFileRoute('/app/settings')({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => (typeof s.tab === 'string' ? { tab: s.tab as Tab } : {}),
  component: Settings,
})

function Settings() {
  usePageTitle(tr('Settings'))
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/app/settings' })
  const tab = search.tab ?? 'workspace'
  return (
    <div className="pb-16">
      <PageHeader title={tr('Settings')}>
        <div className="-mb-4 flex gap-1 overflow-x-auto">
          {(['workspace', 'team', 'appearance', 'operator', 'data'] as Tab[]).map((t) => (
            <button key={t} type="button" onClick={() => void navigate({ search: { tab: t } })} className={cn('relative h-9 px-3 text-[13px] capitalize transition-colors', tab === t ? 'font-medium text-ink' : 'text-ink-3 hover:text-ink')}>
              {t}
              {tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-ink" />}
            </button>
          ))}
        </div>
      </PageHeader>
      <div className="mx-auto max-w-[760px] px-5 py-8 md:px-8">
        {tab === 'workspace' && <WorkspaceTab />}
        {tab === 'team' && <TeamTab />}
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'operator' && <OperatorTab />}
        {tab === 'data' && <DataTab />}
      </div>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-line py-8 first:pt-0 last:border-b-0 md:grid-cols-[220px_1fr]">
      <div>
        <h2 className="text-[14px] font-medium text-ink">{title}</h2>
        {description && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{description}</p>}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  )
}

function WorkspaceTab() {
  const s = useSnapshot()
  const { commit, canWrite } = useActions()
  const [name, setName] = useState(s.workspace.name)
  const [nif, setNif] = useState(s.workspace.nif ?? '')
  const [sector, setSector] = useState<Sector>(s.workspace.sector)
  const [region, setRegion] = useState<Region>(s.workspace.region)
  const digits = nif.replace(/\D/g, '')
  const nifOk = !digits || isValidNIF(digits)
  const dirty = name !== s.workspace.name || digits !== (s.workspace.nif ?? '') || sector !== s.workspace.sector || region !== s.workspace.region
  return (
    <>
      <Section title={tr('Business')} description={tr('Shown on purchase orders and exports.')}>
        <Field label={tr('Name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canWrite} />
        </Field>
        <Field label="NIF" error={!nifOk && digits.length >= 9 ? tr('Check digit doesn’t match') : null} hint={digits.length === 9 && nifOk ? `✓ ${nifKind(digits)}` : tr('Portuguese tax number')}>
          <Input value={formatNIF(digits)} onChange={(e) => setNif(e.target.value.replace(/\D/g, '').slice(0, 9))} inputMode="numeric" disabled={!canWrite} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr('Sector')}>
            <Select
              value={sector}
              onChange={setSector}
              options={[
                { value: 'grocery', label: tr('Grocery & deli') },
                { value: 'cafe', label: tr('Café & bakery') },
                { value: 'retail', label: tr('Retail') },
                { value: 'pharmacy', label: tr('Pharmacy & health') },
                { value: 'hardware', label: tr('Hardware & trade') },
                { value: 'ecommerce', label: tr('Online store') },
                { value: 'other', label: tr('Other') },
              ]}
            />
          </Field>
          <Field label={tr('IVA region')}>
            <Select value={region} onChange={setRegion} options={(Object.keys(REGION_LABEL) as Region[]).map((r) => ({ value: r, label: REGION_LABEL[r] }))} />
          </Field>
        </div>
        {canWrite && (
          <div>
            <Button variant="primary" disabled={!dirty || !nifOk || !name.trim()} onClick={() => void commit({ workspace: { name: name.trim(), nif: digits || null, sector, region } }, { success: tr('Saved') })}>
              {tr('Save')}
            </Button>
          </div>
        )}
      </Section>
      <OrderEmail />
    </>
  )
}

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: 'admin', label: tr('Admin'), hint: tr('Everything, including team and settings') },
  { value: 'member', label: tr('Member'), hint: tr('Receive, count, order, adjust') },
  { value: 'viewer', label: tr('Viewer'), hint: tr('Read-only — ideal for your accountant') },
]

/** Whether orders leave from this installation or from the person's own mail app, and what the host has to set. */
function OrderEmail() {
  const mail = useMail()
  const { session } = useSession()
  const code = (v: string) => <code className="rounded bg-hover px-1 font-mono text-[12px]">{v}</code>
  return (
    <Section title={tr('Order email')} description={tr('How purchase orders reach your suppliers.')}>
      <Card className="flex items-center gap-3 p-4">
        <EnvelopeSimpleIcon size={20} className="shrink-0 text-ink-2" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-ink">{mail.enabled ? tr('Sent by this installation') : tr('Opens in your email app')}</div>
          <div className="truncate text-[12.5px] text-ink-3">{mail.enabled ? tr('From {0}. Replies come to whoever sent the order.', mail.from) : tr('The order is written for you; you press send.')}</div>
        </div>
        <Badge tone={mail.enabled ? 'ok' : 'neutral'} dot>
          {mail.enabled ? tr('On') : tr('Off')}
        </Badge>
      </Card>
      {!mail.enabled && session?.mode === 'cloud' && (
        <p className="text-[12.5px] leading-relaxed text-ink-3">
          {tr('To send orders from Nau, whoever hosts it sets')} {code('RESEND_API_KEY')} {tr('and')} {code('NAU_MAIL_FROM')} {tr('on the server and restarts. Until then nothing changes.')}
        </p>
      )}
    </Section>
  )
}

function TeamTab() {
  const s = useSnapshot()
  const { commit, canWrite } = useActions()
  const { session } = useSession()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('member')
  const valid = /^\S+@\S+\.\S+$/.test(email)
  const invite = () => {
    if (s.members.some((m) => m.email.toLowerCase() === email.toLowerCase())) return toast.error(tr('Already in the team'))
    const m: Member = { id: uid(), name: email.split('@')[0], email: email.trim().toLowerCase(), role, status: 'invited', hue: hashString(email) % 360 }
    void commit({ upserts: { members: [m] }, events: [{ id: uid(), kind: 'member', title: tr('Invited {0} as {1}', m.email, role), actor: { kind: 'user', name: session?.user.name ?? '' }, createdAt: new Date().toISOString() }] }, { success: tr('Invitation added'), description: tr('They get access the moment they sign up with this email.') })
    setEmail('')
  }
  const link = typeof window !== 'undefined' ? `${window.location.origin}/signup` : '/signup'
  return (
    <>
      <Section title={tr('Invite')} description={tr('Invitees get access as soon as they create a Nau account with that email.')}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={tr('name@business.pt')} className="flex-1" disabled={!canWrite} aria-label={tr('Email')} />
          <Select value={role} onChange={setRole} options={ROLES} className="sm:w-40" />
          <Button variant="primary" disabled={!valid || !canWrite} onClick={invite}>
            {tr('Invite')}
          </Button>
        </div>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(link).then(() => toast.success(tr('Sign-up link copied')))} className="flex w-fit items-center gap-1.5 text-[12.5px] text-ink-3 hover:text-ink">
          <LinkIcon size={13} /> {tr('Copy sign-up link to send')}
        </button>
      </Section>
      <Section title={tr('Members')} description={tr('{0} people', s.members.length)}>
        <ul className="flex flex-col">
          {s.members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 border-t border-line py-3 first:border-t-0">
              <Avatar name={m.name} hue={m.hue} size={32} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] text-ink">
                  {m.name} {m.email === session?.user.email && <span className="text-ink-4">{tr('· you')}</span>}
                </div>
                <div className="truncate text-[12px] text-ink-3">{m.email}</div>
              </div>
              {m.status === 'invited' && <Badge tone="warn">{tr('Invited')}</Badge>}
              {m.role === 'owner' ? (
                <Badge tone="neutral">{tr('Owner')}</Badge>
              ) : (
                <>
                  <Select size="sm" value={m.role} onChange={(r) => void commit({ upserts: { members: [{ ...m, role: r }] } }, { success: tr('Role updated') })} options={ROLES} className="w-28" disabled={!canWrite} aria-label={tr('Role for {0}', m.name)} />
                  {canWrite && (
                    <button type="button" aria-label={tr('Remove {0}', m.name)} onClick={() => void commit({ removes: { members: [m.id] } }, { success: tr('Removed {0}', m.name), undo: { upserts: { members: [m] } } })} className="touch-target flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-bad-soft hover:text-bad-ink">
                      <TrashIcon size={14} />
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </Section>
    </>
  )
}

const ACCENTS: { value: Accent; label: string; c: string }[] = [
  { value: 'ember', label: tr('Ember'), c: 'var(--orange-9)' },
  { value: 'atlantic', label: tr('Atlantic'), c: 'var(--blue-9)' },
  { value: 'lilac', label: tr('Lilac'), c: 'var(--violet-9)' },
  { value: 'moss', label: tr('Moss'), c: 'var(--grass-9)' },
]

function AppearanceTab() {
  const ui = useUI()
  const groups = useNavEntries()
  return (
    <>
      <Section title={tr('Theme')} description={tr('Follow your system, or pick one.')}>
        <Segmented
          value={ui.theme}
          onChange={(t) => ui.set({ theme: t })}
          options={[
            { value: 'system', label: tr('System') },
            { value: 'light', label: tr('Light') },
            { value: 'dark', label: tr('Dark') },
          ]}
        />
      </Section>
      <Section title={tr('Accent')} description={tr('Used for highlights, charts and focus.')}>
        <div className="flex flex-wrap gap-2">
          {ACCENTS.map((a) => (
            <button key={a.value} type="button" onClick={() => ui.set({ accent: a.value })} aria-pressed={ui.accent === a.value} className={cn('press flex h-10 items-center gap-2 rounded-[10px] px-3 text-[13px] shadow-card', ui.accent === a.value ? 'bg-surface text-ink shadow-[0_0_0_2px_var(--gray-12)]' : 'bg-surface text-ink-2')}>
              <span className="size-4 rounded-full" style={{ background: a.c }} />
              {a.label}
            </button>
          ))}
        </div>
      </Section>
      <Section title={tr('Language')} description={tr('The whole app changes. The page loads again.')}>
        <Segmented value={currentLang()} onChange={(v: Lang) => v !== currentLang() && setLang(v)} options={LANGS.map((l) => ({ value: l.value, label: l.label }))} />
      </Section>
      <Section title={tr('Numbers')} description={tr('How euros and decimals are written.')}>
        <Segmented
          value={ui.numberLocale}
          onChange={(v) => ui.set({ numberLocale: v })}
          options={[
            { value: 'en-IE', label: '€1,234.50' },
            { value: 'pt-PT', label: '1234,50 €' },
          ]}
        />
      </Section>
      <Section title={tr('Sidebar')} description={tr('Hide what your team doesn’t use.')}>
        {groups
          .flatMap((g) => g.items)
          .filter((e) => e.key !== 'home')
          .map((e) => (
            <Switch key={e.key} checked={!ui.hiddenNav.includes(e.key)} onChange={(v) => ui.set({ hiddenNav: v ? ui.hiddenNav.filter((k) => k !== e.key) : [...ui.hiddenNav, e.key] })} label={e.label} />
          ))}
      </Section>
    </>
  )
}

function OperatorTab() {
  const { engine, model } = useOperator()
  return (
    <>
      <Section title={tr('Engine')} description={tr('Operator uses an AI model when the server has a key, and its built-in engine otherwise.')}>
        <Card className="flex items-center gap-3 p-4">
          <Mark size={20} className="text-accent" />
          <div className="flex-1">
            <div className="text-[14px] font-medium text-ink">{engine === 'claude' ? tr('AI model connected') : tr('Built-in engine')}</div>
            <div className="text-[12.5px] text-ink-3">{engine === 'claude' ? tr('{0} · answers, plans and prepares work with your tools', model) : tr('Understands common requests: stock questions, reorders, transfers, forecasts, widgets.')}</div>
          </div>
          <Badge tone={engine === 'claude' ? 'ok' : 'neutral'} dot>
            {engine === 'claude' ? tr('Online') : tr('Offline')}
          </Badge>
        </Card>
        {engine !== 'claude' && <p className="text-[12.5px] text-ink-3">{tr('To enable the AI model, set')} <code className="rounded bg-hover px-1 font-mono text-[12px]">ANTHROPIC_API_KEY</code> {tr('on the server and restart. Invoice reading from photos uses it too.')}</p>}
      </Section>
      <Section title={tr('Autonomy')} description={tr('What Operator may do without asking.')}>
        <a href="/app/autopilot" className="text-[13px] text-ink underline underline-offset-2">
          {tr('Open Autopilot settings →')}
        </a>
      </Section>
    </>
  )
}

function DataTab() {
  const s = useSnapshot()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { session, backend, workspaceId, refreshWorkspaces, setWorkspace } = useSession()
  const [confirm, setConfirm] = useState(false)
  const [typed, setTyped] = useState('')
  const owner = s.members.find((m) => m.email === session?.user.email)?.role === 'owner' || session?.mode !== 'cloud'
  const demo = session?.mode === 'demo'
  useEffect(() => setTyped(''), [confirm])
  return (
    <>
      <Section title={tr('Export')} description={tr('Everything in your workspace, as one file. It’s your data.')}>
        <div>
          <Button icon={<DownloadSimpleIcon size={14} />} onClick={() => downloadFile(`nau-${s.workspace.slug}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(s, null, 2), 'application/json')}>
            {tr('Download workspace (JSON)')}
          </Button>
        </div>
      </Section>
      {demo && (
        <Section title={tr('Reset demo')} description={tr('Start Casa Ribeira again from a fresh, realistic state.')}>
          <div>
            <Button
              onClick={async () => {
                await resetDemo()
                await qc.invalidateQueries({ queryKey: snapshotKey('demo', workspaceId) })
                toast.success(tr('Demo reset'))
              }}
            >
              {tr('Reset demo data')}
            </Button>
          </div>
        </Section>
      )}
      {!demo && owner && (
        <Section title={tr('Delete workspace')} description={tr('Removes every item, movement and document. This can’t be undone.')}>
          <div>
            <Button variant="danger" icon={<TrashIcon size={14} />} onClick={() => setConfirm(true)}>
              {tr('Delete {0}', s.workspace.name)}
            </Button>
          </div>
        </Section>
      )}
      {confirm && (
        <Modal
          open
          onOpenChange={setConfirm}
          title={tr('Delete {0}?', s.workspace.name)}
          description={tr('Download an export first if you might need anything later.')}
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                {tr('Cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={typed !== s.workspace.name}
                onClick={async () => {
                  if (!backend || !workspaceId) return
                  await backend.deleteWorkspace(workspaceId)
                  const ws = await refreshWorkspaces()
                  setWorkspace(ws[0]?.id ?? null)
                  toast.success(tr('Workspace deleted'))
                  void navigate({ to: ws.length ? '/app' : '/onboarding' })
                }}
              >
                {tr('Delete forever')}
              </Button>
            </>
          }
        >
          <Field label={tr('Type “{0}” to confirm', s.workspace.name)}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </Field>
        </Modal>
      )}
      <p className="mt-6 flex items-center gap-1.5 text-[12px] text-ink-4">
        <CopyIcon size={12} /> {tr('Workspace ID')} <span className="font-mono">{s.workspace.id}</span>
      </p>
    </>
  )
}
