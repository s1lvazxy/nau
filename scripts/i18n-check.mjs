#!/usr/bin/env node
// Checks that every string passed to tr() or msg() has a translation into the other language.
//   node scripts/i18n-check.mjs            report and fail on gaps
//   node scripts/i18n-check.mjs --missing   print the missing keys as JSON, by source language
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
// Files written in Portuguese; everything else is written in English.
const PT_SOURCE = [/^src\/components\/(landing|onboarding|auth|marketing)\//, /^src\/components\/lang-switch\.tsx$/, /^src\/routes\/(index|en|brand|contact|login|signup|forgot-password|reset-password|onboarding)\.tsx$/, /^src\/ingest\/(tabular|files|saft)\.ts$/]

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
const files = walk(path.join(root, 'src')).filter((f) => /\.tsx?$/.test(f) && !/__tests__|\/i18n\/|routeTree\.gen|test-setup/.test(f))

const CALL = /\b(?:tr|msg)\(\s*(?:'([^'\\\n]*)'|("(?:[^"\\\n]|\\.)*"))/g
const keys = { en: new Map(), pt: new Map() } // source language → key → first file
for (const file of files) {
  const rel = path.relative(root, file)
  const lang = PT_SOURCE.some((re) => re.test(rel)) ? 'pt' : 'en'
  const text = fs.readFileSync(file, 'utf8')
  for (const m of text.matchAll(CALL)) {
    const key = m[1] ?? JSON.parse(m[2])
    if (!keys[lang].has(key)) keys[lang].set(key, rel)
  }
}

const load = async (name) => (await import(path.join(root, 'src/i18n', `${name}.ts`)))[name]
const pt = await load('pt') // English → Portuguese
const en = await load('en') // Portuguese → English
const slots = (s) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(',')

const missing = { en: [], pt: [] }
const broken = []
for (const [src, dict, lang] of [['en', pt, 'en'], ['pt', en, 'pt']]) {
  for (const [key] of keys[src]) {
    const hit = dict[key]
    if (hit === undefined) missing[lang].push(key)
    else if (slots(hit) !== slots(key)) broken.push(`${key}  →  ${hit}`)
  }
}
const unused = [...Object.keys(pt).filter((k) => !keys.en.has(k)), ...Object.keys(en).filter((k) => !keys.pt.has(k))]

if (process.argv.includes('--missing')) {
  process.stdout.write(JSON.stringify(missing, null, 0))
  process.exit(0)
}
console.log(`${keys.en.size} English strings, ${keys.pt.size} Portuguese strings in ${files.length} files`)
console.log(`missing: ${missing.en.length} without Portuguese, ${missing.pt.length} without English`)
for (const k of [...missing.en, ...missing.pt].slice(0, 40)) console.log('  · ' + k.slice(0, 120))
if (broken.length) console.log(`placeholders differ in ${broken.length}:\n` + broken.map((b) => '  · ' + b.slice(0, 200)).join('\n'))
if (unused.length) console.log(`${unused.length} dictionary entries are not used by the code (kept for stored text or left over)`)
process.exit(missing.en.length || missing.pt.length || broken.length ? 1 : 0)
