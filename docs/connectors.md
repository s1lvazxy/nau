# Connectors

A connector translates one outside system into the shapes in `src/ingest/types.ts`. Everything after that — matching products, creating items, moving stock, journalling with an undo — is shared by every source through `ingest()`.

```
vendor API ──pull()──▶ IngestBatch ──ingest()──▶ ChangeSet ──apply_changeset_service()──▶ Postgres
webhook ────parse()──▶     │                        │
spreadsheet, SAF-T, photo ─┘                        └─ journal entry with an undo
public API (/api/v1) ──────┘
```

## Status

| System | Catalogue | Stock | Sales | Stock back | Live | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Moloni | ✓ | ✓ | ✓ | | | beta |
| InvoiceXpress | ✓ | | ✓ | | | beta |
| Vendus | ✓ | ✓ | ✓ | | | beta |
| Shopify | ✓ | ✓ | ✓ | ✓ | webhooks | beta |
| WooCommerce | ✓ | ✓ | ✓ | ✓ | webhooks | beta |
| Square | ✓ | | ✓ | | webhooks | beta |
| SumUp | | | ✓ (by product name) | | | beta |
| TOConline, Zone Soft, WinRest | | | | | | planned — use SAF-T or the API |

**Beta** means built and tested against the vendor's public documentation with recorded response shapes (`src/connectors/__tests__`), and not yet proven against a live account. The WooCommerce path is also exercised end to end against a local stand-in shop in the integration tests. If you run one against a real account, please report what you see.

SAF-T (PT) covers every certified invoicing program in Portugal with one file: products, prices and every sales line of the period.

## Writing one

1. **Describe it** in `src/connectors/catalog.ts`: name, family, the credential fields to ask for (mark secrets), and what it can do. This file is imported by the browser, so no network code here.
2. **Implement `Connector`** (`src/connectors/types.ts`) in `src/connectors/impl/<id>.ts`:
   - `test(ctx)` proves the credentials and names the account. Nothing is saved when it throws.
   - `pull(ctx)` returns `{ batch, cursor, more?, creds? }`. Read the catalogue when `catalogDue(ctx)`; read documents from `since(ctx)`. Return `more: true` to be called again soon — a first sync brings months of history in slices. Return rotated tokens in `creds`.
   - `pushStock(ctx, levels)` if the system takes stock from Nau.
   - `webhook.verify` and `webhook.parse` if it calls back. `parse` returns a batch, or `null` to answer the hook by running a normal sync.
3. **Register it** in `src/connectors/index.ts`.
4. **Test it** against the documented response shapes in `src/connectors/__tests__/connectors.test.ts`.

Rules that keep connectors safe:

- Use `request()` from `src/connectors/http.ts`. Pass `untrusted: true` whenever the host was typed by a person: private and loopback addresses are refused and redirects are not followed.
- Give every product and document a stable `ref`. Ids in Nau derive from it, so a replayed sync or webhook changes nothing.
- Prices in a batch are shelf prices with VAT; costs are net. Convert at the edge (`gross()` helps).
- A sale that was later cancelled or refunded is a second document of kind `refund`, never an edit.
- Never log credentials. Errors shown to people come from `ConnectorError`.

## What ingest does with a batch

- **Products**: matched by link (seen before), SKU, barcode, then exact name. New ones are created with their category and supplier.
- **Stock figures** apply on the first sync only, as "the level today, after the history": the sales history replays underneath and the level lands on the figure.
- **Sales and refunds** become ledger movements dated at the document, with deterministic ids.
- **Purchases** become draft receipts in Receive for a person to check in (or post directly with `postPurchases`).
- **Costs** are weighted averages in the order deliveries happened.
- Each sync is one journal entry that can be undone from Approvals.
