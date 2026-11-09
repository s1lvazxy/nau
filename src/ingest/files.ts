import { toTable, type Table } from './tabular'
import { saftToBatch, type SaftSummary } from './saft'

/** Old Portuguese software still exports Windows-1252. Try UTF-8 strictly and fall back, so “Descrição” survives. */
export function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

/** CSV with `;`, `,` or tabs, quoted fields and embedded line breaks → rows of cells. */
export function csvGrid(text: string): string[][] {
  const head = text.slice(0, 4000).split(/\r?\n/).slice(0, 5).join('\n')
  const count = (c: string) => head.split(c).length - 1
  const delim = count('\t') > Math.max(count(';'), count(',')) ? '\t' : count(';') >= count(',') && count(';') > 0 ? ';' : ','
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === delim) {
      cur.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      cur.push(field)
      rows.push(cur)
      cur = []
      field = ''
    } else field += c
  }
  if (field || cur.length) {
    cur.push(field)
    rows.push(cur)
  }
  return rows
}

export type ReadFile = { kind: 'tables'; name: string; tables: Table[] } | { kind: 'saft'; name: string; summary: SaftSummary } | { kind: 'photo'; name: string; file: File } | { kind: 'error'; name: string; error: string }

const MAX = 60 * 1024 * 1024

/** Works out what a dropped file is and reads it in the browser. Nothing is uploaded here. */
export async function readFile(file: File): Promise<ReadFile> {
  const name = file.name
  const ext = name.toLowerCase().split('.').pop() ?? ''
  try {
    if (file.size > MAX) return { kind: 'error', name, error: 'O ficheiro tem mais de 60 MB. Exporta um período mais curto.' }
    if (file.type.startsWith('image/') || ext === 'pdf' || ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext)) {
      if (ext === 'heic') return { kind: 'error', name, error: 'Fotos HEIC ainda não abrem aqui. No iPhone, partilha como JPEG ou tira um ecrã.' }
      return { kind: 'photo', name, file }
    }
    if (ext === 'xlsx') {
      const { default: readExcelFile } = await import('read-excel-file/browser')
      const sheets = (await readExcelFile(file)) as unknown as { sheet: string; data: unknown[][] }[]
      const tables = sheets.map((s) => toTable(sheets.length > 1 ? `${name} · ${s.sheet}` : name, s.data)).filter((t) => t.rows.length && t.headers.length > 1)
      return tables.length ? { kind: 'tables', name, tables } : { kind: 'error', name, error: 'Não encontrámos uma tabela neste ficheiro.' }
    }
    if (ext === 'xls') return { kind: 'error', name, error: 'Este é o formato antigo do Excel (.xls). Abre-o e guarda como .xlsx ou .csv.' }
    const text = decodeText(await file.arrayBuffer())
    if (ext === 'xml' || /^\s*<\?xml|<AuditFile/.test(text.slice(0, 2000))) return { kind: 'saft', name, summary: saftToBatch(text) }
    const table = toTable(name, csvGrid(text))
    return table.rows.length && table.headers.length > 1 ? { kind: 'tables', name, tables: [table] } : { kind: 'error', name, error: 'Não encontrámos uma tabela neste ficheiro.' }
  } catch (e) {
    return { kind: 'error', name, error: e instanceof Error ? e.message : 'Não conseguimos ler este ficheiro.' }
  }
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((ok, fail) => {
    const fr = new FileReader()
    fr.onload = () => ok(String(fr.result).split(',')[1] ?? '')
    fr.onerror = () => fail(new Error('Não conseguimos ler o ficheiro.'))
    fr.readAsDataURL(file)
  })
}
