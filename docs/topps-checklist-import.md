# Topps Checklist Import

The Topps Checklist Browser is data-first:

- PDFs are imported once.
- Raw extracted PDF text is preserved.
- Parsed records are stored as `topps_sets`, `topps_checklist_cards`, and `topps_pdf_sources`.
- Supabase Postgres is the production catalog source of truth.
- Cloudflare KV is not a checklist source of truth and is not used as a Topps card/set fallback.

## Sample Import

```powershell
npm.cmd run topps:import:sample
```

This imports the first three PDFs from:

`C:\Users\Sales\Downloads\toppsChecklist.zip`

It writes:

- `data/topps/topps_checklists_index.sample.json` for the browser's GitHub Pages fallback
- `data/topps/topps_checklists_index.json` as an ignored local full/sample export
- `data/topps/topps_sets.json`
- `data/topps/topps_checklist_cards.json`
- `data/topps/topps_pdf_sources.sample.json`
- `data/topps/topps_pdf_sources.json.gz`

## Full Import

```powershell
npm.cmd run topps:import
```

The importer is resumable. It uses `.topps-import/` as a local scratch/cache folder and keeps that folder out of git.

## Apply Supabase Schema

Run `supabase/topps-checklists.sql` once in the Supabase SQL editor, or with the Supabase CLI if you have project access.

It creates:

- `topps_import_meta`
- `topps_sets`
- `topps_checklist_cards`
- `topps_pdf_sources`
- `pricecharting_matches_cache`

These tables are public-read and service-role/admin-write. Do not put the service role key in `dashboard.html`.

## Import To Supabase

After `npm.cmd run topps:import` has produced the full local JSON files, set a service role key only in your shell and run:

```powershell
$env:SUPABASE_URL="https://vroknjrxubsqyexngwus.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
npm.cmd run topps:import:supabase
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
```

The importer upserts sources, sets, and cards, so it is safe to rerun when new Topps checklist PDFs are added.

## Worker Supabase Secrets

The Cloudflare Worker reads Supabase first when these secrets/vars exist:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY`

The service role key is best for Worker-only server calls. Never expose it in frontend HTML.

## Disabled Legacy KV Import

Do not publish Topps checklist cards to Worker KV. The Worker returns `410` for old `/topps-checklists/import-*` endpoints.

The full generated card/source files are intentionally ignored by git because the complete batch is hundreds of MB. Supabase is the production source of truth; `topps_checklists_index.sample.json` is only a lightweight fallback for local/GitHub Pages testing before the Worker/Supabase path is available.

## Parser Notes

Topps checklist PDFs use mixed layouts, including multi-column text extraction. The parser is intentionally heuristic and keeps raw source text so parser improvements can reprocess existing PDFs later.
