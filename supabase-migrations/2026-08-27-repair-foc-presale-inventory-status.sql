-- Repair FOC eBay presales that were accidentally exposed as ordinary shop
-- inventory after a partial marketplace sale. Explicitly received/converted
-- rows carry ebayPresaleConverted=true and must remain in_stock.
update public.inventory_items
set
  status = 'presale',
  data = jsonb_set(
    jsonb_set(coalesce(data, '{}'::jsonb), '{status}', '"presale"'::jsonb, true),
    '{lifecycle}',
    '"presale"'::jsonb,
    true
  ),
  updated_at = now()
where status = 'in_stock'
  and data ->> 'source' = 'foc_presale'
  and coalesce((data ->> 'ebayPresaleConverted')::boolean, false) = false
  and coalesce(nullif(data ->> 'quantity', '')::numeric, nullif(data ->> 'qty', '')::numeric, 0) > 0;

-- SECURITY DEFINER RPCs should never inherit PostgreSQL's default PUBLIC
-- execute grant. Application users retain only the calls their authenticated
-- dashboard workflows require; service_role remains available for backend use.
revoke execute on function public.accept_store_invite(uuid) from public, anon;
revoke execute on function public.invite_store_member(uuid, text, public.store_role) from public, anon;
revoke execute on function public.complete_pos_sale(jsonb) from public, anon;
revoke execute on function public.create_store_for_current_user(text, text) from public, anon;

grant execute on function public.accept_store_invite(uuid) to authenticated, service_role;
grant execute on function public.invite_store_member(uuid, text, public.store_role) to authenticated, service_role;
grant execute on function public.complete_pos_sale(jsonb) to authenticated, service_role;

-- Store creation is deliberately backend-only; the 2026-08-20 migration
-- already revoked it from authenticated users to close self-signup.
grant execute on function public.create_store_for_current_user(text, text) to service_role;
