-- Profit summary for a Whatnot show, saved when its show report is imported
-- (gross, fees, cost of goods, giveaway cost, net, per-buyer totals), so
-- shows can be compared later. Additive; nothing reads it but the dashboard.
alter table public.whatnot_shows add column if not exists report_summary jsonb;
