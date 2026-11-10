-- Purchase orders can be emailed to the supplier by the server (Resend), when the host configured it.
-- An order is queued when someone — a person or Operator, inside its policy — sends it; the server delivers
-- the queue and writes back what happened. Without mail configured nothing is ever queued.

alter table public.purchase_orders
  add column email_status text check (email_status in ('queued', 'sent', 'failed')),
  add column email_queued_at timestamptz,
  add column emailed_at timestamptz,
  add column email_error text;

create index purchase_orders_email_queue_idx on public.purchase_orders (email_status) where email_status = 'queued';
