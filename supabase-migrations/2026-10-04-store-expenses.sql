-- Money spent running the business, so profit and cash flow are real:
--   kind 'expense'   -- show/table fees, supplies, shipping supplies, software,
--                       gas... comes off profit.
--   kind 'inventory' -- stock bought (distributor orders, collections, sealed).
--                       Not a loss: it turns cash into stock, and each item's
--                       cost comes off profit when it sells. Counted in cash
--                       flow, not profit.
create table if not exists public.store_expenses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  spent_on date not null default current_date,
  kind text not null default 'expense' check (kind in ('expense','inventory')),
  category text not null default 'Other',
  amount numeric(12,2) not null check (amount > 0 and amount < 1000000),
  note text,
  show_session_id text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists store_expenses_store_date on public.store_expenses(store_id, spent_on desc);

alter table public.store_expenses enable row level security;
drop policy if exists store_expenses_select_manager on public.store_expenses;
create policy store_expenses_select_manager on public.store_expenses for select using (public.current_store_role(store_id) in ('owner','admin','manager'));
drop policy if exists store_expenses_insert_manager on public.store_expenses;
create policy store_expenses_insert_manager on public.store_expenses for insert with check (public.current_store_role(store_id) in ('owner','admin','manager'));
drop policy if exists store_expenses_update_manager on public.store_expenses;
create policy store_expenses_update_manager on public.store_expenses for update using (public.current_store_role(store_id) in ('owner','admin','manager')) with check (public.current_store_role(store_id) in ('owner','admin','manager'));
drop policy if exists store_expenses_delete_admin on public.store_expenses;
create policy store_expenses_delete_admin on public.store_expenses for delete using (public.current_store_role(store_id) in ('owner','admin'));
