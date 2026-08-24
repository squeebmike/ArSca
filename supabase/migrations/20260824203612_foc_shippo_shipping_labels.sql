alter table public.foc_preorder_orders
  add column if not exists shipping_label_status text,
  add column if not exists shipping_label_transaction_id text,
  add column if not exists shipping_label_url text,
  add column if not exists shipping_label_amount_cents integer,
  add column if not exists shipping_tracking_number text,
  add column if not exists shipping_tracking_url text,
  add column if not exists shipping_label_purchased_at timestamptz,
  add column if not exists shipping_label_error text;

alter table public.foc_preorder_orders
  drop constraint if exists foc_preorder_orders_shipping_label_status_check,
  add constraint foc_preorder_orders_shipping_label_status_check
    check (shipping_label_status is null or shipping_label_status in ('purchasing','purchased','failed','review_required')),
  drop constraint if exists foc_preorder_orders_shipping_label_amount_check,
  add constraint foc_preorder_orders_shipping_label_amount_check
    check (shipping_label_amount_cents is null or shipping_label_amount_cents >= 0);

create unique index if not exists idx_foc_orders_shippo_transaction
  on public.foc_preorder_orders(shipping_label_transaction_id)
  where shipping_label_transaction_id is not null;

comment on column public.foc_preorder_orders.shipping_label_status is
  'Shippo label purchase state. purchasing is an atomic duplicate-purchase guard; review_required blocks retries after an ambiguous network outcome.';

comment on column public.foc_preorder_orders.shipping_label_transaction_id is
  'Shippo transaction object ID for the purchased shipping label.';
