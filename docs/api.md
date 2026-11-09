# Nau API v1

The API is the generic connector: anything that can make an HTTP request can feed Nau and read it back. It needs an installation with the server database configured (see `docs/self-hosting.md`).

- Base URL: `https://<your-nau>/api/v1`
- Authentication: `Authorization: Bearer nau_…`. Create keys under **Integrations → API & webhooks**. A key belongs to one workspace and is either read-only or read and write. Nau stores only the SHA-256 of a key; it is shown once.
- Limits: 300 requests per minute per key. Bodies up to 4 MB.
- Errors: `{ "error": { "code": "invalid", "message": "…", "details": [{ "path": "documents.0.date", "message": "…" }] } }` with status 400, 401, 403, 404, 413, 422, 429 or 500. A 500 can always be retried safely.

## Write

### `POST /documents` — sales, returns and deliveries

Send one document, or `{ "documents": [ … ] }` with up to 500.

```json
{
  "ref": "FS-2026-1418",
  "kind": "sale",
  "number": "FS 2026/1418",
  "date": "2026-11-09T18:30:00Z",
  "location": "Bonfim",
  "lines": [
    { "sku": "AZ-500", "name": "Azeite Virgem 500ml", "qty": 2, "unitPrice": 7.9 }
  ]
}
```

| Field | Notes |
| --- | --- |
| `ref` | Your id for the document. **Sending the same `ref` again changes nothing**, so retries are safe. |
| `kind` | `sale` takes stock out, `refund` puts it back, `purchase` is a delivery from a supplier. |
| `date` | ISO date or date-time. The movement is recorded at this moment. |
| `location` | Name or code of a location in Nau. Omitted: the default location. |
| `party` | For purchases: `{ "name", "nif" }` of the supplier. Created when new. |
| `lines[].sku` / `barcode` / `productRef` / `name` | A line is matched to an item by your product id (`productRef`) if seen before, then SKU, then barcode, then exact name. A line that matches nothing creates the item. |
| `lines[].unitPrice` | Shelf price, VAT included. `unitCost` is net of VAT. |
| `lines[].lot`, `expiresOn` | For items that track expiry. |

Purchases arrive as **drafts in Receive** for someone to check in. Add `?post=true` to post them straight to stock.

Response:

```json
{ "data": { "accepted": 1, "already_known": 0, "lines_applied": 1, "items_created": 0, "units_sold_without_stock": 0 } }
```

### `POST /products` — create or update the catalogue

```json
{
  "products": [
    { "ref": "p-12", "sku": "AZ-500", "name": "Azeite Virgem 500ml", "barcode": "5601234567890",
      "category": "Mercearia", "cost": 4.1, "price": 7.9, "vatRate": 6, "supplier": "Lagar do Vale",
      "stock": [{ "location": "Bonfim", "qty": 30 }] }
  ],
  "setStock": true
}
```

`setStock: true` treats the stock figures as today's truth and writes the difference as a count. `update: false` creates what is missing and leaves existing items alone.

## Read

| Endpoint | Returns |
| --- | --- |
| `GET /items` | The catalogue with `on_hand` and stock per location. `?archived=true` includes archived items. |
| `GET /stock` | One row per item and location: `sku`, `location`, `on_hand`. |
| `GET /movements` | The ledger, newest first. `?since=<ISO>&type=sale&limit=200` (max 1000). Covers the last 120 days. |
| `GET /orders` | Purchase orders with their lines. `?status=sent` |

Every response is `{ "data": … }`.

## Webhooks (outbound)

Add an endpoint under **Integrations → API & webhooks**. Nau posts each entry of the workspace's activity feed, in order and at least once:

```json
{ "id": "…", "type": "activity.sync", "created_at": "2026-11-09T18:31:02Z", "workspace_id": "…",
  "data": { "title": "Shopify: 12 sales", "detail": null, "actor": { "kind": "system", "name": "Shopify" }, "link": "/app/integrations" } }
```

Types follow the feed: `activity.sync`, `activity.receipt`, `activity.order`, `activity.transfer`, `activity.adjustment`, `activity.count`, `activity.item`, `activity.import`, `activity.undo`, and others as features add them. A webhook says that something happened; read the details with the API.

Verify each call. The header is `Nau-Signature: t=<unix seconds>,v1=<hex>` where `v1 = HMAC-SHA256(secret, "<t>.<raw body>")`:

```js
import crypto from 'node:crypto'
function verify(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')))
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  return expected.length === v1.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1))
}
```

Answer with any 2xx within 10 seconds. A failed delivery keeps its place and is retried on the next tick (every five minutes); after 30 failures in a row the endpoint is switched off. Endpoints must be public HTTPS addresses.
