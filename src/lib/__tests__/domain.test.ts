import { describe, expect, it } from 'vitest'
import { createDemoSnapshot } from '../seed'
import { derive, kpis, generateProposals, morningBrief, forecast, salesSeries } from '../analytics'
import { isValidNIF, makeNIF, atInventoryCSV, parseSAFT } from '../pt'

describe('domain', () => {
  const s = createDemoSnapshot()
  it('builds a coherent demo workspace', () => {
    const k = kpis(s)
    const st = derive(s).stats
    const counts: Record<string, number> = {}
    for (const x of st) counts[x.status] = (counts[x.status] || 0) + 1
    console.log('movements', s.movements.length, 'items', s.items.length, 'batches', s.batches.length)
    console.log('kpis', JSON.stringify({ ...k, today: k.today, d7: k.d7 }))
    console.log('statuses', counts)
    console.log('proposals', s.proposals.map((p) => `${p.kind}: ${p.title} — ${p.summary} (€${p.impactEur})`).join('\n'))
    console.log('brief', morningBrief(s).lines.map((l) => l.text).join(' | '))
    console.log('forecast alvarinho', forecast(s, s.items.find((i) => i.name.includes('Alvarinho'))!.id, 7))
    console.log('series', salesSeries(s, 7))
    expect(s.items.length).toBeGreaterThan(40)
    expect(k.stockValue).toBeGreaterThan(1000)
    expect(s.proposals.length).toBeGreaterThan(2)
    expect(generateProposals(s).length).toBe(s.proposals.length)
  })
  it('validates NIFs', () => {
    expect(isValidNIF('501964843')).toBe(true)
    expect(isValidNIF('501964844')).toBe(false)
    expect(isValidNIF(makeNIF('51623498'))).toBe(true)
  })
  it('exports AT csv', () => {
    const csv = atInventoryCSV([{ category: 'M', code: 'A1', description: 'Sardinhas; azeite', numberCode: '560', qty: 3.5, unit: 'un' }])
    expect(csv.split('\r\n')[1]).toBe('M;A1;Sardinhas, azeite;560;3,50;UN')
  })
})
