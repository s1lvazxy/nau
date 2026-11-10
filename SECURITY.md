# Security

## Reporting a vulnerability

Use **Report a vulnerability** under the Security tab of this repository (GitHub private vulnerability reporting). Please do not open a public issue. You will get an answer within three working days, and credit in the release notes if you want it.

## How Nau is put together

- **Tenancy.** Every workspace table carries `workspace_id`. Row-level security lets a signed-in person read only the workspaces they belong to.
- **Writes.** Browsers cannot write to tables. Every change is a change set applied by `apply_changeset()`, which checks the member's role in the database, appends to the ledger and enforces limits in one transaction.
- **The server's reach.** Connectors, the public API and the scheduled Operator write through `apply_changeset_service()`, which only the service role may execute. The service-role key lives on the server and is never sent to a browser.
- **Secrets at rest.** Connector credentials are sealed with AES-256-GCM under `NAU_SECRET_KEY`. API keys are stored as SHA-256 hashes and shown once. The tables holding them have row-level security on and no policy: no client role can read them.
- **Outbound requests.** Addresses typed by a person (a shop URL, a webhook endpoint) must be public HTTPS hosts. Private, loopback and link-local addresses are refused, and redirects are not followed.
- **Inbound webhooks** are acted on only when their signature matches the secret stored with the connection.
- **Email.** Nau sends mail only when the host configures Resend, and only purchase orders that a member (or Operator, inside the policy) sent, to the address on the supplier. Each attempt carries an idempotency key. The API key stays on the server.
- **Operator.** The model never touches the database. It calls tools; tools validate their input and go through the workspace policy. Operator cannot widen its own authority: a change to the policy always waits for a person. Everything it does alone is journalled with an undo.

## Known limits

- The in-process rate limiter is per server instance. Put a rate limit at the proxy in production.
- Connectors marked beta have not been proven against live accounts.
- With email configured, any member who can send an order can make the installation email the address they put on a supplier, from your domain. Give the member role to people you would let write to suppliers in the company's name.
- The check on person-typed addresses resolves the host before the request; it does not pin the address, so DNS rebinding is not fully closed. Run the server where it cannot reach sensitive internal services, or behind an egress proxy.
- Text that arrives from outside — product and supplier names from a connected system or a file — is read by the model when Operator runs. The policy is the boundary: a run steered by hostile text can only do reversible, journalled work, and anything with money or an outside effect still waits for a person.
- The legal texts in `src/routes/legal.$doc.tsx` are drafts and need review before commercial use.
