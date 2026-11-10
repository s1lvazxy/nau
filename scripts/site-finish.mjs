// Finishes the static website after `VITE_LANDING_ONLY=1 vite build`: a 404 page and the marker GitHub Pages reads.
import { writeFileSync } from 'node:fs'

const base = process.env.NAU_BASE ?? '/nau/'
const out = '.output/public'

writeFileSync(`${out}/.nojekyll`, '')
writeFileSync(
  `${out}/404.html`,
  `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Nau — 404</title>
<link rel="icon" href="${base}favicon.svg" type="image/svg+xml">
<style>
  html { color-scheme: dark; background: #0a0a0a; color: #fff; font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
  body { min-height: 100dvh; margin: 0; display: grid; place-items: center; padding: 24px; }
  main { max-width: 26rem; }
  h1 { margin: 28px 0 8px; font-size: 2rem; line-height: 1.1; font-weight: 500; letter-spacing: -0.03em; }
  p { margin: 0; color: rgb(255 255 255 / 0.58); }
  a { display: inline-flex; align-items: center; height: 44px; margin-top: 28px; padding: 0 22px; border-radius: 999px; background: #fff; color: #0a0a0a; font-weight: 500; font-size: 15px; text-decoration: none; }
  a:focus-visible { outline: 2px solid #ff5b1f; outline-offset: 3px; }
</style>
</head>
<body>
<main>
  <svg viewBox="0 0 512 512" width="28" height="28" fill="currentColor" aria-hidden="true">${[0, 45, 90, 135, 180, 225, 270, 315].map((d) => `<rect x="235" y="${256 - (d % 90 ? 168 : 230)}" width="42" height="${(d % 90 ? 168 : 230) - 92}" rx="21" transform="rotate(${d} 256 256)"/>`).join('')}<rect x="220" y="220" width="72" height="72" rx="18"/></svg>
  <h1>Esta página não existe.</h1>
  <p lang="en">This page doesn’t exist.</p>
  <a href="${base}">Voltar ao início</a>
</main>
</body>
</html>
`,
)
console.log(`static website ready in ${out} (served under ${base})`)
