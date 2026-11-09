# Nau — design system

**Concept.** *Light through the rose.* The mark — a compass rose around a unit of stock — is a piece of dark glass. Raw data enters as one beam and leaves organised along its eight rays. The website is dark, and colour only ever arrives as light.

## Identity
- **Mark**: rosa-dos-ventos around a unit of stock. 512 grid; 8 rays of 42 with round caps from r=92; cardinals to 230, diagonals to 168; core 72 with 18 corner. Source: `design/brand/nau-brand.ai` (Illustrator); exports in `design/brand/export` and `public/brand`.
- **Wordmark**: “nau”, medium weight, −0.045em.
- **App icon**: an ember light under near-black glass with the white mark (`AppIcon`).
- The mark animates only as a “working” state (rays pulse in sequence); off under reduced motion.

## Colour
- **Website**: Night `#0a0a0a` surfaces, Graphite `#111–#151515` panels, Bone `#ededed` type. Ember `#ff5b1f` and Peach `#ffb48a` are light, never paint: glows, lit edges, the hero line, the count that fills. No full-colour sections.
- **Product**: Radix Colors ramps (`gray`, `orange`, `blue`, `violet`, `grass`, `amber`, `red`) behind semantic tokens in `src/styles/app.css` (`canvas`, `panel`, `surface`, `ink*`, `line`, `accent*`, status tokens). Dark is the default theme; light stays available in settings. Accent is user-selectable (Ember, Atlantic, Lilac, Moss).
- Status colour is meaning, never decoration: green healthy, amber reorder, red out/critical, blue overstock/info, violet not moving.

## Type
- **Brand voice** (website, brand, sign-in headings): Instrument Sans Variable. Headings are two-tone — the thought in white, its second half in `white/38`. The ember gradient is reserved for the hero line. No serif.
- **Product voice** (app, and any product UI shown on the site): Geist Variable, with Geist Mono for times and codes.
- `tabular-nums` on every changing number. Portuguese formats on the site (`1 940 €`, `−11,80 €`).

## The website, chapter by chapter
Each chapter has its own form, so no two read alike (`src/components/landing/`):
1. **Hero** — copy left, the glass rose right, rendered live in WebGPU with vgpu (`rose/`), static fallback without WebGPU.
2. **Bento** — six jobs, each with a lit monochrome isometric scene (`scenes.tsx`, SVG + GSAP).
3. **Autopilot** — one pinned moment: six checks run with the scroll and feed a giant count that fills with light.
4. **Operator** — a centred prompt on the real engine; the answer unfolds beneath it.
5. **Dashboard** — the real dashboard lies back in 3D and stands up over its own heading.
6. **Portugal** — a typographic index: six words at full size, the active one lit, its instrument in a sticky panel.
7. **FAQ** — a quiet column of hairlines.
8. **Closing** — the rose again, centred, with the last call to action; footer ending on the wordmark.

A construction frame (two hairlines, rules with nodes) runs behind everything and ties the chapters together.

## Motion
- Easing tokens: `--ease-out` (0.23,1,0.32,1), `--ease-in-out` (0.77,0,0.175,1), `--ease-drawer` (0.32,0.72,0,1).
- Website: GSAP. Headings split into lines and rise out of a mask (SplitText); blocks rise in batches; ScrollTrigger scrubs the Autopilot run, the dashboard tilt, the Portugal scrollspy and the footer wordmark. Timelines are built with explicit start and end values so a remount can never strand them. Everything rests in its final state under reduced motion.
- App: buttons scale 0.97 on press; popovers/menus 150ms from `--transform-origin`; modals 200ms from 0.97; sheets 380ms drawer curve. Command menu and ⌘J panel open instantly.

## Shape & depth
Radii 6/8/12/16/22/28. On the site, `.spot` cards answer the pointer with a soft inner light and a lit hairline. In the app, content sits in an inset panel on the canvas; cards use `shadow-card`, popovers `shadow-pop`.

## Components
Base UI primitives wrapped in `src/components/ui/`, custom SVG charts (`AreaChart`, `Sparkline`, `MiniBars`, `BarList`, `StackedBar`, `Ring`, `AnimatedNumber`), `StockCompass` (the mark as a data rose: one ray per category, length = health).

## Onboarding — the manifest

The first-run flow (`/onboarding`, PT-PT) is built around where the data comes from, not around account fields.
Concept: a ship's manifest. A panel on the right lists what is coming aboard — items, suppliers, sales history,
stock value, locations, what Operator may do alone — and fills in as the person answers and drops files.
It is the proof that Nau understood the files before anything is created. The eight rays of the mark light up
as the three steps complete. Same tokens and components as the app; numbers roll with NumberFlow; rows and file
cards enter with a short rise. On phones the manifest sits under the step.

## In-app additions

Integrations, the journal in Approvals (Waiting / Done alone / History, every applied entry with Undo) and the
policy and rules in Autopilot use the app's existing cards, segmented controls and badges. Connector status is
stated in words (Beta, Planned); no vendor logos are used.
