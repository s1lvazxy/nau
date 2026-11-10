import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { CompassIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { useSnapshot } from '~/data/store'
import { autopilotPass } from '~/agent/autopilot'
import { policyOf, spentToday } from '~/agent/policy'
import { eur, relative } from '~/lib/format'
import type { Policy, Rule, Workspace } from '~/lib/types'
import { uid } from '~/lib/utils'
import { Button, IconButton } from '~/components/ui/button'
import { Field, Input, NumberInput, Segmented, Select, Switch, Textarea } from '~/components/ui/form'
import { Modal } from '~/components/ui/overlay'
import { Card, PageHeader } from '~/components/ui/primitives'
import { useActions } from '~/components/app/actions'
import { usePageTitle } from '~/components/app/page'
import { Mark } from '~/components/brand/logo'
import { tr } from '~/i18n'

const CADENCE = { hourly: tr('Every hour'), daily: tr('Every morning'), weekly: tr('Once a week') }

export const Route = createFileRoute('/app/autopilot')({ component: Autopilot })

const REACH: { key: 'reversible' | 'money' | 'outbound'; label: string; body: string }[] = [
  { key: 'reversible', label: tr('Reversible work'), body: tr('Catalogue, draft orders, counts, rules, dashboards and settings. Journalled, with an Undo.') },
  { key: 'money', label: tr('Spending'), body: tr('Sending a purchase order to a supplier.') },
  { key: 'outbound', label: tr('Leaving Nau'), body: tr('Writing stock to a connected shop, cancelling an order already sent.') },
]

const TRIGGERS: { value: Rule['trigger']; label: string }[] = [
  { value: 'hourly', label: tr('Every hour') },
  { value: 'daily', label: tr('Every morning') },
  { value: 'weekly', label: tr('Once a week') },
  { value: 'on_sync', label: tr('After each sync') },
  { value: 'on_receipt', label: tr('After each delivery') },
]

function Autopilot() {
  usePageTitle(tr('Autopilot'))
  const s = useSnapshot()
  const { commit, canWrite } = useActions()
  const settings = s.workspace.settings
  const policy = policyOf(settings)
  const spent = spentToday(s)
  const [editing, setEditing] = useState<Rule | 'new' | null>(null)
  const setSettings = (patch: Partial<Workspace['settings']>) => void commit({ workspace: { settings: { ...settings, ...patch } } })
  const setPolicy = (patch: Partial<Policy>) => setSettings({ policy: { ...policy, ...patch } })
  return (
    <div className="pb-12">
      <PageHeader title={tr('Autopilot')} description={tr('What Nau watches for you, the rules it follows, and how far it may go on its own.')} actions={canWrite && <Button variant="primary" icon={<CompassIcon size={14} />} onClick={() => void commit(autopilotPass(s), { success: tr('Autopilot ran') })}>{tr('Run now')}</Button>} />
      <div className="mx-auto grid max-w-[1100px] gap-6 px-5 py-6 md:px-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-[13px] font-medium text-ink-2">{tr('Rules')}</h2>
                <p className="mt-0.5 text-[12.5px] text-ink-3">{tr('Standing instructions in your own words. Operator carries them out by itself, inside the limits on the right.')}</p>
              </div>
              {canWrite && (
                <Button size="sm" icon={<PlusIcon size={12} />} onClick={() => setEditing('new')}>
                  {tr('New rule')}
                </Button>
              )}
            </div>
            {s.rules.length === 0 ? (
              <Card className="flex flex-col gap-3 p-5">
                <p className="text-[13px] leading-relaxed text-ink-3">{tr('No rules yet. Write one here, or just tell Operator — “every Friday, draft the Sogrape order if the Alvarinho covers less than three weeks” — and it saves the rule for you.')}</p>
                {canWrite && (
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        [tr('Every morning, check in the draft deliveries that match an open order line by line.'), 'daily'],
                        [tr('After each sync, archive items that came in with no name and tell me which.'), 'on_sync'],
                        [tr('On Mondays, start a count of the ten items with the highest value on hand.'), 'weekly'],
                      ] as const
                    ).map(([t, trigger]) => (
                      <button key={t} type="button" onClick={() => setEditing({ id: uid(), name: '', instruction: t, trigger, enabled: true, createdBy: 'user', createdAt: new Date().toISOString() })} className="press rounded-full bg-hover px-3 py-1.5 text-left text-[12.5px] text-ink-2 hover:text-ink">
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </Card>
            ) : (
              s.rules.map((r) => (
                <Card key={r.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <Switch
                        checked={r.enabled}
                        disabled={!canWrite}
                        onChange={(v) => void commit({ upserts: { rules: [{ ...r, enabled: v }] } }, { success: `${r.name} ${v ? tr('on') : tr('off')}` })}
                        label={
                          <span className="flex flex-wrap items-center gap-2">
                            {r.name}
                            <span className="rounded-full bg-hover px-2 py-0.5 text-[11px] font-normal text-ink-3">{TRIGGERS.find((t) => t.value === r.trigger)?.label}</span>
                            {r.createdBy === 'agent' && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-[11px] font-normal text-ink-3">
                                <Mark size={9} /> {tr('written by Operator')}
                              </span>
                            )}
                          </span>
                        }
                        description={r.instruction}
                      />
                    </div>
                    {canWrite && (
                      <div className="flex shrink-0 gap-0.5">
                        <IconButton size="sm" label={tr('Edit {0}', r.name)} onClick={() => setEditing(r)}>
                          <PencilSimpleIcon size={14} />
                        </IconButton>
                        <IconButton size="sm" label={tr('Delete {0}', r.name)} onClick={() => void commit({ removes: { rules: [r.id] } }, { success: tr('Rule deleted'), undo: { upserts: { rules: [r] } } })}>
                          <TrashIcon size={14} />
                        </IconButton>
                      </div>
                    )}
                  </div>
                  {r.lastRunAt && (
                    <p className="mt-3 border-t border-line pt-3 text-[12.5px] leading-relaxed whitespace-pre-line text-ink-3">
                      <span className="text-ink-4">{tr('Last run {0} ·', relative(r.lastRunAt))} </span>
                      {r.lastResult}
                    </p>
                  )}
                </Card>
              ))
            )}
            <p className="text-[12px] text-ink-4">{tr('Rules run on the server with the AI model, on the schedule. In local mode and the demo they are saved but do not run by themselves.')}</p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-[13px] font-medium text-ink-2">{tr('Playbooks')}</h2>
            {s.playbooks.map((p) => (
              <Card key={p.id} className="p-4">
                <Switch
                  checked={p.enabled}
                  disabled={!canWrite}
                  onChange={(v) => void commit({ upserts: { playbooks: [{ ...p, enabled: v }] } }, { success: `${p.name} ${v ? tr('on') : tr('off')}` })}
                  label={
                    <span className="flex items-center gap-2">
                      {tr(p.name)}
                      <span className="rounded-full bg-hover px-2 py-0.5 text-[11px] font-normal text-ink-3">{CADENCE[p.cadence]}</span>
                    </span>
                  }
                  description={
                    <>
                      {tr(p.description)}
                      {p.lastRunAt && <span className="text-ink-4"> {tr('· last run {0}', relative(p.lastRunAt))}</span>}
                    </>
                  }
                />
              </Card>
            ))}
          </section>
        </div>

        <section className="flex flex-col gap-4">
          <h2 className="text-[13px] font-medium text-ink-2">{tr('What Operator may do alone')}</h2>
          <Card className="flex flex-col gap-5 p-5">
            <div className="flex items-start gap-3">
              <Mark size={18} className="mt-0.5 shrink-0 text-accent" />
              <p className="text-[12.5px] leading-relaxed text-ink-3">
                <b className="font-medium text-ink">{tr('Alone')}</b> {tr('means it acts and writes it in the journal, where you can undo it.')} <b className="font-medium text-ink">{tr('Ask')}</b> {tr('leaves a card in Approvals. A physical move Operator decided by itself always asks — someone has to carry the boxes.')}
              </p>
            </div>
            {REACH.map((a) => (
              <div key={a.key} className="flex flex-col gap-2 border-t border-line pt-4">
                <div>
                  <div className="text-[13px] font-medium text-ink">{a.label}</div>
                  <div className="text-[12px] text-ink-3">{a.body}</div>
                </div>
                <Segmented
                  size="sm"
                  value={policy[a.key]}
                  onChange={(v: 'auto' | 'ask') => canWrite && setPolicy({ [a.key]: v })}
                  options={[
                    { value: 'ask', label: tr('Ask') },
                    { value: 'auto', label: a.key === 'reversible' ? tr('Alone') : tr('Alone, under the limits') },
                  ]}
                />
              </div>
            ))}
            {(
              [
                ['perActionLimit', tr('Limit per action'), tr('Above this, spending and sending wait for you.')],
                ['dailyLimit', tr('Limit per day'), tr('Summed over what Operator did alone today · {0} used.', eur(spent, { decimals: 0 }))],
              ] as const
            ).map(([k, l, d]) => (
              <label key={k} className="flex items-center justify-between gap-3 border-t border-line pt-4">
                <span>
                  <span className="block text-[13px] font-medium text-ink">{l}</span>
                  <span className="block text-[12px] text-ink-3">{d}</span>
                </span>
                <span className="flex items-center gap-1.5 text-[13px] text-ink-3">
                  €
                  <NumberInput value={policy[k]} min={0} step={50} onChange={(v) => canWrite && setPolicy({ [k]: Math.max(0, Math.round(v)) })} className="w-24" disabled={!canWrite || (policy.money === 'ask' && policy.outbound === 'ask')} />
                </span>
              </label>
            ))}
          </Card>
          <Card className="flex flex-col gap-4 p-5">
            <h3 className="text-[13px] font-medium text-ink">{tr('Thresholds')}</h3>
            {(
              [
                ['reviewDays', tr('Review period'), tr('Days of demand each order should cover beyond lead time.')],
                ['deadStockDays', tr('Not moving after'), tr('Days without a sale before an item counts as dead stock.')],
                ['expiryWarnDays', tr('Expiry warning'), tr('Days before expiry that a lot is flagged.')],
              ] as const
            ).map(([k, l, d]) => (
              <label key={k} className="flex items-center justify-between gap-3">
                <span>
                  <span className="block text-[13px] text-ink">{l}</span>
                  <span className="block text-[12px] text-ink-3">{d}</span>
                </span>
                <NumberInput value={settings[k]} min={1} onChange={(v) => canWrite && setSettings({ [k]: Math.round(v) })} className="w-20" disabled={!canWrite} />
              </label>
            ))}
          </Card>
        </section>
      </div>
      {editing && <RuleDialog rule={editing === 'new' ? null : editing} taken={s.rules.map((r) => r.name)} onClose={() => setEditing(null)} onSave={(r) => (void commit({ upserts: { rules: [r] } }, { success: tr('Rule saved') }), setEditing(null))} />}
    </div>
  )
}

function RuleDialog({ rule, taken, onClose, onSave }: { rule: Rule | null; taken: string[]; onClose: () => void; onSave: (r: Rule) => void }) {
  const [name, setName] = useState(rule?.name ?? '')
  const [instruction, setInstruction] = useState(rule?.instruction ?? '')
  const [trigger, setTrigger] = useState<Rule['trigger']>(rule?.trigger ?? 'daily')
  const clash = taken.some((t) => t.toLowerCase() === name.trim().toLowerCase() && t !== rule?.name)
  const ok = name.trim().length >= 2 && instruction.trim().length >= 8 && !clash
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={rule?.name ? tr('Edit rule') : tr('New rule')}
      description={tr('Say what you want done and when it matters. Operator follows it inside the limits you set.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tr('Cancel')}
          </Button>
          <Button variant="primary" disabled={!ok} onClick={() => onSave({ ...(rule ?? { id: uid(), enabled: true, createdBy: 'user', createdAt: new Date().toISOString(), lastRunAt: null, lastResult: null }), name: name.trim(), instruction: instruction.trim(), trigger })}>
            {tr('Save rule')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <Field label={tr('Name')} htmlFor="rule-name" error={clash ? tr('Another rule already has this name.') : null}>
          <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('Friday — Sogrape order')} maxLength={80} autoFocus={!rule?.instruction} />
        </Field>
        <Field label={tr('Instruction')} htmlFor="rule-text" hint={tr('Plain language. Name the items, suppliers and numbers that matter.')}>
          <Textarea id="rule-text" rows={4} value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={1200} placeholder={tr('Draft the Sogrape order when the Alvarinho covers less than three weeks, and round up to full cases of six.')} />
        </Field>
        <Field label={tr('Runs')}>
          <Select value={trigger} onChange={setTrigger} options={TRIGGERS} />
        </Field>
      </div>
    </Modal>
  )
}
