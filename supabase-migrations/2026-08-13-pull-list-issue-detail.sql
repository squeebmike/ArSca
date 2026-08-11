-- Lets a saved pull-list item remember its Metron issue id, so clicking its
-- cover later can open full issue detail (description, credits, sibling/
-- variant covers) without re-resolving it by title. Run after
-- 2026-08-12-pull-lists.sql.

alter table public.pull_list_items add column if not exists metron_issue_id text;
