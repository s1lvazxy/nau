# Launch on X

One post with four images, then three replies with a demo video each. Written for developers and the open-source crowd, in English.

## The post

Attach `01-hook.jpg`, `02-problem.jpg`, `03-operator.jpg` and `04-open-source.jpg`, in that order. They are 16:9, so the 2×2 grid shows each one whole. 277 characters with the link.

```
Nau is out: open-source inventory that runs itself.

An AI operator drafts the purchase orders, opens the stock counts and moves stock between shops. What it does alone has an Undo. What costs money waits for a person.

AGPL, self-hosted, no paid tier.

https://github.com/s1lvazxy/nau
```

## The replies

Post them as a thread under the first one, one video each.

**1 · `nau-01-dashboard.mp4`** (20 s)

```
The home screen: the week in one sentence, stock health at a glance, and what is waiting for your yes.
```

**2 · `nau-02-operator.mp4`** (23 s)

```
Operator: ask in plain words and it leaves the work done. 36 tools, every write goes through a policy, and every action it takes alone has an Undo.
```

**3 · `nau-03-approvals.mp4`** (15 s)

```
Approvals: each suggestion says why, in euros and in days. Sending an order to a supplier waits for a person, unless you set a limit.
```

**4 · no media**

```
Three lines to try it, no account and no key:

git clone https://github.com/s1lvazxy/nau && cd nau
pnpm install
pnpm dev

Built for shops, cafés and restaurants in Portugal: SAF-T, NIF, IVA and the year-end inventory file for the AT.
```

## Alt text

- `01-hook.jpg`: The Nau mark as dark glass lit from within, beside the words “Inventory that runs itself.”
- `02-problem.jpg`: “A shop’s stock lives in four places. The invoicing program. A spreadsheet. A paper invoice. Somebody’s head. Nau reads the first three and replaces the fourth.”
- `03-operator.jpg`: “The AI does the work. You approve what costs money.” beside Operator drafting a purchase order marked “Done by Operator”, with an Undo.
- `04-open-source.jpg`: “No plans. No paid tier. No licence key.” above a terminal with git clone, pnpm install and pnpm dev.

## How these were made

Nothing here is drawn by hand or generated. The glass mark is the website's own shader (`src/components/landing/rose/rose.wgsl`) rendered from other camera angles, the type is Geist, and every screen is the real app running the demo shop.

To rebuild after the product changes, start the app with `pnpm dev` and run `src/build.sh`. It needs Playwright with Chromium, ffmpeg and Python with Pillow.

- `src/cards.html`: the four images. Edit the copy here.
- `src/clip1.cjs`, `clip2.cjs`, `clip3.cjs`: the three videos, as a script of camera moves, pointer moves and captions.
- `src/reclib.cjs`: the recorder. It runs the page three times slower and speeds the film back up, which is what makes software rendering smooth.
