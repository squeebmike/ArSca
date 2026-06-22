# Topps Checklist Import

The Topps Checklist Browser is data-first:

- PDFs are imported once.
- Raw extracted PDF text is preserved.
- Parsed records are stored as `topps_sets`, `topps_checklist_cards`, and `topps_pdf_sources`.
- PriceCharting matches are cached in Worker KV as `topps_pc_match:{cardId}`.

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

## Publish To Worker KV

```powershell
node scripts/import-topps-checklists.js --publish
```

Optional:

```powershell
node scripts/import-topps-checklists.js --zip="C:\path\to\newToppsChecklist.zip" --publish
```

Re-running is safe. The Worker replaces the Topps set index, source index, and chunked card rows, then caches PriceCharting matches lazily as cards are opened.

The full generated card/source files are intentionally ignored by git because the complete batch is hundreds of MB. The published Worker KV database is the production source of truth; `topps_checklists_index.sample.json` is only a lightweight fallback for local/GitHub Pages testing before KV is available.

## Parser Notes

Topps checklist PDFs use mixed layouts, including multi-column text extraction. The parser is intentionally heuristic and keeps raw source text so parser improvements can reprocess existing PDFs later.
