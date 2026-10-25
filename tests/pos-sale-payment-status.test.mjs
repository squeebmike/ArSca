import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Every register sale read "unpaid": complete_pos_sale inserted the sale
// without payment_status (column default 'unpaid'), though its payments
// were saved and confirmed -- 314 completed sales, each fully covered.
const sql = readFileSync(new URL('../supabase-migrations/2026-10-25-pos-sale-payment-status.sql', import.meta.url), 'utf8');
const fn = sql.slice(sql.indexOf('create or replace function public.complete_pos_sale'), sql.indexOf('$function$;') + 11);
const paidAt = fn.indexOf("set payment_status = 'paid'");
assert.ok(paidAt > 0, 'the sale is marked paid');
assert.ok(paidAt > fn.indexOf('insert into public.pos_payments ('), 'after its payments are saved');
assert.ok(paidAt < fn.indexOf("p_bundle -> 'drawerMovements'"));
assert.match(fn, /where sale_id = v_sale_id and status in \('confirmed','succeeded'\)\) >= coalesce\(\(v_sale ->> 'total'\)::numeric,0\) - 0\.005;/, 'only when the confirmed payments cover the total');
assert.match(fn, /if exists \(select 1 from public\.pos_sales where id = v_sale_id/, 'a retried sale still does nothing twice');
assert.match(fn, / security definer\n set search_path to 'public', 'pg_temp'/);
// The rest of the function is the 2026-08-31 one, unchanged.
const prev = readFileSync(new URL('../supabase-migrations/2026-08-31-pos-sale-line-taxable.sql', import.meta.url), 'utf8');
const prevFn = prev.slice(prev.indexOf('create or replace function public.complete_pos_sale'), prev.indexOf('$function$;') + 11);
const added = fn.slice(fn.indexOf('  -- Paid once the confirmed payments cover the total.'), fn.indexOf("  for v_row in select value from jsonb_array_elements(coalesce(p_bundle -> 'drawerMovements'"));
assert.equal(fn.replace(added, ''), prevFn, 'nothing else in the function changed');
// Existing sales are corrected the same way.
assert.match(sql.slice(sql.indexOf('$function$;')), /update public\.pos_sales s\s+set payment_status = 'paid'\s+where s\.status = 'completed'\s+and s\.payment_status = 'unpaid'\s+and \(select coalesce\(sum\(p\.amount\),0\) from public\.pos_payments p\s+where p\.sale_id = s\.id and p\.status in \('confirmed','succeeded'\)\) >= s\.total - 0\.005;/);
console.log('POS sale payment status checks passed');
