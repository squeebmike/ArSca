-- Grading submissions: items sent out to a grading company (PSA/BGS/CGC/
-- other) -- submission date, expected return, cost, and eventual grade
-- result. Distinct from the existing PSA cert lookup/verify feature, which
-- only looks up certs that are ALREADY graded -- this tracks items still in
-- transit so a store can see what's out, what it cost, and (once the
-- actual_return_at/grade_result are filled in) what it's worth back.

create table if not exists public.grading_submissions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  -- Optional link back to the inventory item this submission is for. Left
  -- null when the item hasn't been added to inventory yet (e.g. raw stock
  -- pulled straight from a purchase to send out), in which case item_name
  -- below is the only record of what it was.
  inventory_id uuid references public.inventory_items(id) on delete set null,
  item_name text not null,
  category text,
  grader text not null default 'PSA',
  service_level text,
  submission_cost numeric(10,2) not null default 0,
  declared_value numeric(10,2) not null default 0,
  submitted_at date not null default current_date,
  expected_return_at date,
  actual_return_at date,
  tracking_number text,
  status text not null default 'submitted',
  grade_result text,
  cert_number text,
  -- What the item is worth once graded, filled in manually when known --
  -- paired with declared_value + submission_cost to show ROI once back.
  market_value_after numeric(10,2),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_grading_submissions_store on public.grading_submissions(store_id, status, submitted_at desc);
create index if not exists idx_grading_submissions_inventory on public.grading_submissions(inventory_id) where inventory_id is not null;

alter table public.grading_submissions enable row level security;

drop policy if exists grading_submissions_select_member on public.grading_submissions;
create policy grading_submissions_select_member on public.grading_submissions for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists grading_submissions_insert_employee on public.grading_submissions;
create policy grading_submissions_insert_employee on public.grading_submissions for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists grading_submissions_update_employee on public.grading_submissions;
create policy grading_submissions_update_employee on public.grading_submissions for update using (public.current_store_role(store_id) in ('owner','admin','manager','employee')) with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
