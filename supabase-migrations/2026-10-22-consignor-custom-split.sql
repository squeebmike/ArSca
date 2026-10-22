-- New consignments take the store's sliding scale by asking price (store
-- keeps 30% under $50, 25% to $250, 20% to $1,000, 15% above) unless the
-- person has a percent of their own. custom_split marks that: false (every
-- existing person) means the scale; store_split_percent is only used when
-- it's true.

alter table public.consignor_people add column if not exists custom_split boolean not null default false;
