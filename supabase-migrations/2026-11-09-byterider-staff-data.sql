-- Staff ByteRider (dashboard, owner/admin only): one read-only lookup the
-- Worker calls with the service key. Every answer is a small summary, so a
-- question costs a few KB of egress, never the whole inventory.
-- Not callable from the browser: execute is for service_role only.

create or replace function public.byterider_num(v text) returns numeric
language sql immutable as $$
  select case when v ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then trim(v)::numeric end
$$;

create or replace function public.byterider_staff_data(p_store uuid, p_tool text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s text := p_store::text;
  q text := nullif(trim(coalesce(p_args->>'query', '')), '');
  cat text := nullif(trim(coalesce(p_args->>'category', '')), '');
  lim int := least(greatest(coalesce(public.byterider_num(p_args->>'limit')::int, 15), 1), 40);
  d_from date := coalesce((nullif(p_args->>'from', ''))::date, current_date - 30);
  d_to date := coalesce((nullif(p_args->>'to', ''))::date, current_date);
  days int := least(greatest(coalesce(public.byterider_num(p_args->>'days')::int, 90), 7), 730);
  out jsonb;
begin
  if p_tool = 'inventory_search' then
    select coalesce(jsonb_agg(r), '[]') into out from (
      select coalesce(i.data->>'name', i.data->>'title') as name, i.data->>'setName' as set, coalesce(i.data->>'cardNumber', i.data->>'card_number') as number,
        i.data->>'category' as category, i.status, coalesce(public.byterider_num(i.data->>'quantity'), public.byterider_num(i.data->>'qty'), 0) as qty,
        coalesce(public.byterider_num(i.data->>'price'), public.byterider_num(i.data->>'salePrice')) as price,
        public.byterider_num(i.data->>'marketPrice') as market,
        coalesce(public.byterider_num(i.data->>'costBasis'), public.byterider_num(i.data->>'cost')) as cost,
        coalesce(i.data->>'condition', i.data->>'grade') as condition, i.created_at::date as added
      from inventory_items i
      where i.store_id = p_store and i.status not in ('archived')
        and (coalesce(p_args->>'include_sold', '') = 'true' or i.status <> 'sold')
        and (cat is null or i.data->>'category' ilike '%' || cat || '%')
        and (q is null or (coalesce(i.data->>'name', '') || ' ' || coalesce(i.data->>'title', '') || ' ' || coalesce(i.data->>'setName', '') || ' ' || coalesce(i.data->>'player', '') || ' ' || coalesce(i.data->>'cardNumber', '') || ' ' || coalesce(i.data->>'publisher', '')) ilike all (select '%' || w || '%' from regexp_split_to_table(q, '\s+') w where w <> ''))
      order by coalesce(public.byterider_num(i.data->>'price'), 0) desc
      limit lim) r;
    return jsonb_build_object('items', out, 'note', 'up to ' || lim || ', most expensive first');

  elsif p_tool = 'inventory_summary' then
    select coalesce(jsonb_agg(r order by r.retail desc), '[]') into out from (
      select coalesce(nullif(i.data->>'category', ''), 'Other') as category, i.status, count(*) as listings,
        sum(coalesce(public.byterider_num(i.data->>'quantity'), public.byterider_num(i.data->>'qty'), 0)) as units,
        round(sum(coalesce(public.byterider_num(i.data->>'quantity'), public.byterider_num(i.data->>'qty'), 0) * coalesce(public.byterider_num(i.data->>'price'), public.byterider_num(i.data->>'salePrice'), 0)), 2) as retail,
        round(sum(coalesce(public.byterider_num(i.data->>'quantity'), public.byterider_num(i.data->>'qty'), 0) * coalesce(public.byterider_num(i.data->>'costBasis'), public.byterider_num(i.data->>'cost'), 0)), 2) as cost
      from inventory_items i where i.store_id = p_store and i.status in ('in_stock', 'active', 'presale')
        and (cat is null or i.data->>'category' ilike '%' || cat || '%')
      group by 1, 2) r;
    return jsonb_build_object('by_category', out);

  elsif p_tool = 'sales_summary' then
    if coalesce(p_args->>'group_by', 'channel') = 'channel' then
      select coalesce(jsonb_agg(r order by r.amount desc), '[]') into out from (
        select p.method as channel, count(distinct p.sale_id) as sales, round(sum(p.amount), 2) as amount
        from pos_payments p join pos_sales x on x.id = p.sale_id
        where x.store_id = s and x.status = 'completed' and coalesce(p.status, '') not in ('failed', 'canceled', 'cancelled', 'voided')
          and coalesce(x.completed_at, x.created_at)::date between d_from and d_to
        group by 1) r;
    else
      select coalesce(jsonb_agg(r), '[]') into out from (
        select case p_args->>'group_by' when 'day' then coalesce(x.completed_at, x.created_at)::date::text when 'item' then l.title else coalesce(nullif(l.category, ''), 'Other') end as key,
          count(distinct x.id) as sales, sum(l.quantity) as units, round(sum(l.unit_price * l.quantity), 2) as revenue,
          round(sum(coalesce(l.cost_basis, 0) * l.quantity), 2) as cost, round(sum(coalesce(l.profit, 0)), 2) as profit
        from pos_sale_lines l join pos_sales x on x.id = l.sale_id
        where x.store_id = s and x.status = 'completed' and coalesce(x.completed_at, x.created_at)::date between d_from and d_to
          and (cat is null or l.category ilike '%' || cat || '%') and (q is null or l.title ilike '%' || q || '%')
        group by 1 order by case when p_args->>'group_by' = 'day' then 0 end, 4 desc limit case when p_args->>'group_by' = 'day' then 62 else lim end) r;
    end if;
    return jsonb_build_object('from', d_from, 'to', d_to, 'group_by', coalesce(p_args->>'group_by', 'channel'), 'rows', out,
      'totals', (select jsonb_build_object('sales', count(*), 'total', round(sum(total), 2), 'tax', round(sum(tax_total), 2), 'discounts', round(sum(discount_total), 2))
        from pos_sales where store_id = s and status = 'completed' and coalesce(completed_at, created_at)::date between d_from and d_to));

  elsif p_tool = 'stale_inventory' then
    select coalesce(jsonb_agg(r), '[]') into out from (
      select coalesce(i.data->>'name', i.data->>'title') as name, i.data->>'setName' as set, i.data->>'category' as category,
        coalesce(public.byterider_num(i.data->>'quantity'), public.byterider_num(i.data->>'qty'), 0) as qty,
        coalesce(public.byterider_num(i.data->>'price'), public.byterider_num(i.data->>'salePrice')) as price,
        coalesce(public.byterider_num(i.data->>'costBasis'), public.byterider_num(i.data->>'cost')) as cost,
        i.created_at::date as added, current_date - i.created_at::date as days_in_stock
      from inventory_items i
      where i.store_id = p_store and i.status = 'in_stock' and i.created_at < now() - make_interval(days => days)
        and (cat is null or i.data->>'category' ilike '%' || cat || '%')
        and not exists (select 1 from pos_sale_lines l where l.store_id = s and l.item_id = i.id::text and l.created_at > now() - make_interval(days => days))
      order by coalesce(public.byterider_num(i.data->>'quantity'), public.byterider_num(i.data->>'qty'), 0) * coalesce(public.byterider_num(i.data->>'price'), 0) desc
      limit lim) r;
    return jsonb_build_object('older_than_days', days, 'items', out, 'note', 'in stock, no sale in that time, biggest shelf value first');

  elsif p_tool = 'foc_preorders' then
    select coalesce(jsonb_agg(r order by r.foc_date), '[]') into out from (
      select c.foc_date, c.distributor, c.status,
        (select count(*) from foc_preorder_orders o where o.cycle_id = c.id and o.status not in ('cancelled', 'canceled', 'draft')) as orders,
        (select round(coalesce(sum(o.total_cents), 0) / 100.0, 2) from foc_preorder_orders o where o.cycle_id = c.id and o.status not in ('cancelled', 'canceled', 'draft')) as total,
        (select coalesce(jsonb_agg(t), '[]') from (select coalesce(it.sku_snapshot->>'title', it.sku_snapshot->>'name') as title, sum(it.quantity) as copies
           from foc_preorder_items it join foc_preorder_orders o on o.id = it.order_id
           where it.cycle_id = c.id and o.status not in ('cancelled', 'canceled', 'draft') group by 1 order by 2 desc limit 10) t) as top_books
      from foc_cycles c where c.store_id = p_store and c.foc_date >= current_date - 14 order by c.foc_date limit 6) r;
    return jsonb_build_object('cycles', out);

  elsif p_tool = 'comic_search' then
    select coalesce(jsonb_agg(r), '[]') into out from (
      select k.title, k.on_sale_date, k.foc_date, k.publisher, round(coalesce(k.customer_price_cents, k.msrp_cents, 0) / 100.0, 2) as price,
        left(regexp_replace(coalesce(k.description, ''), '<[^>]*>', ' ', 'g'), 240) as about
      from comic_skus k where k.store_id = p_store and q is not null and k.title ilike all (select '%' || w || '%' from regexp_split_to_table(q, '\s+') w where w <> '')
      order by k.on_sale_date desc nulls last limit lim) r;
    return jsonb_build_object('comics', out);

  elsif p_tool = 'shows' then
    select coalesce(jsonb_agg(r), '[]') into out from (
      select w.title, w.platform, w.status, w.started_at::date as date, w.peak_audience_size as peak_viewers,
        (select count(*) from whatnot_show_items i where i.show_id = w.id) as items,
        (select count(*) from whatnot_show_items i where i.show_id = w.id and i.status = 'sold') as sold,
        (select round(coalesce(sum(i.sold_price_cents), 0) / 100.0, 2) from whatnot_show_items i where i.show_id = w.id and i.status = 'sold') as revenue,
        (select round(coalesce(sum(i.cost_cents), 0) / 100.0, 2) from whatnot_show_items i where i.show_id = w.id and i.status = 'sold') as cost
      from whatnot_shows w where w.store_id = p_store order by coalesce(w.started_at, w.created_at) desc limit least(lim, 10)) r;
    return jsonb_build_object('shows', out);

  elsif p_tool = 'expenses' then
    select coalesce(jsonb_agg(r order by r.amount desc), '[]') into out from (
      select coalesce(nullif(e.category, ''), e.kind, 'Other') as category, count(*) as entries, round(sum(e.amount), 2) as amount
      from store_expenses e where e.store_id = p_store and e.spent_on between d_from and d_to group by 1) r;
    return jsonb_build_object('from', d_from, 'to', d_to, 'by_category', out);

  elsif p_tool = 'cash_bag' then
    select coalesce(jsonb_agg(r), '[]') into out from (
      select d.register_name, d.status, d.starting_cash, d.expected_cash, d.counted_cash, d.over_short, d.opened_at, d.closed_at
      from pos_drawer_sessions d where d.store_id = s order by d.opened_at desc nulls last limit 5) r;
    return jsonb_build_object('drawers', out);

  elsif p_tool = 'buys' then
    return jsonb_build_object(
      'collection_buys', (select coalesce(jsonb_agg(r), '[]') from (select b.name, b.seller, b.category, b.status::text, b.estimated_card_count, round(b.asking_price_cents / 100.0, 2) as asking, round(b.total_cost_cents / 100.0, 2) as paid, b.created_at::date as date
        from collection_buys b where b.store_id = p_store order by b.created_at desc limit 10) r),
      'buylist_submissions', (select coalesce(jsonb_agg(r), '[]') from (select b.status, b.created_at::date as date, jsonb_array_length(coalesce(b.items, '[]')) as items
        from buylist_submissions b where b.store_id = p_store order by b.created_at desc limit 10) r));

  elsif p_tool = 'customer_wants' then
    select coalesce(jsonb_agg(r), '[]') into out from (
      select w.want_text, w.categories, w.created_at::date as date from customer_wants w where w.store_id = p_store
        and (q is null or w.want_text ilike '%' || q || '%') order by w.created_at desc limit lim) r;
    return jsonb_build_object('wants', out, 'note', 'names and phones left out');
  end if;
  return jsonb_build_object('error', 'unknown tool');
end $$;

revoke all on function public.byterider_staff_data(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.byterider_staff_data(uuid, text, jsonb) to service_role;
