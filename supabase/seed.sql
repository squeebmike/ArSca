-- ArSca tester beta seed data.
-- Use only in local Supabase or a disposable test project. Do not run against live store data.

insert into public.inventory_items (store_id, data, status)
select
  s.id,
  item.data,
  item.status
from public.stores s
cross join lateral (
  values
    (jsonb_build_object('name','Charizard 4/102','category','Pokemon TCG','set','Base Set','card_number','4/102','condition','LP','qty',1,'market',350,'source','tester_seed'), 'in_stock'),
    (jsonb_build_object('name','Sol Ring','category','MTG','set','Commander Masters','set_code','CMM','card_number','400','condition','NM','qty',2,'market',2.50,'source','tester_seed'), 'in_stock'),
    (jsonb_build_object('name','2023 Topps Chrome Julio Rodriguez','category','Sports Cards','year','2023','manufacturer','Topps','set','Topps Chrome','player','Julio Rodriguez','condition','NM','qty',1,'market',12,'source','tester_seed'), 'in_stock'),
    (jsonb_build_object('name','Pokemon 151 Booster Bundle','category','Sealed Product','product_line','151','configuration','Booster Bundle','qty',3,'market',45,'source','tester_seed'), 'in_stock'),
    (jsonb_build_object('name','MTG Play Booster Box','category','Sealed Product','product_line','Magic: The Gathering','configuration','Booster Box','qty',1,'market',140,'source','tester_seed'), 'in_stock'),
    (jsonb_build_object('name','PSA 10 Charmander','category','Slab','grader','PSA','grade','10','condition','Gem Mint','qty',1,'market',85,'source','tester_seed'), 'in_stock'),
    (jsonb_build_object('name','Amazing Spider-Man 300','category','Comic','publisher','Marvel','issue','300','year','1988','condition','FN','qty',1,'market',475,'source','tester_seed'), 'in_stock')
) as item(data, status)
where s.name = 'demo'
on conflict do nothing;
