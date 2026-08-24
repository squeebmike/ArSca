alter table public.foc_preorder_orders
  add column if not exists confirmation_email_sent_at timestamptz,
  add column if not exists confirmation_email_error text;

comment on column public.foc_preorder_orders.confirmation_email_sent_at is
  'Last successful transactional preorder confirmation send time.';

comment on column public.foc_preorder_orders.confirmation_email_error is
  'Most recent transactional preorder confirmation delivery request error.';
