-- Read-only verification after running 2026-07-14-atomic-pos-sale.sql.
-- Cast store IDs to text because the original POS ledger predates the UUID
-- store schema and production currently contains both representations.
select
  to_regprocedure('public.complete_pos_sale(jsonb)') is not null as atomic_sale_function_ready,
  to_regclass('public.pos_sales') is not null as sales_table_ready,
  to_regclass('public.pos_sale_lines') is not null as sale_lines_table_ready,
  to_regclass('public.pos_payments') is not null as payments_table_ready,
  to_regclass('public.customer_receipts') is not null as receipts_table_ready,
  to_regclass('public.customer_wants') is not null as wants_table_ready;

select
  s.id as store_id,
  s.name as store_name,
  count(distinct ps.id) as recorded_sales,
  coalesce(sum(ps.total) filter (where ps.status = 'completed'), 0) as completed_sales_total,
  max(ps.completed_at) as last_recorded_sale
from public.stores s
left join public.pos_sales ps on ps.store_id::text = s.id::text
group by s.id, s.name
order by s.name;

notify pgrst, 'reload schema';
