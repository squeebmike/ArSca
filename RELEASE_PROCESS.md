# Walk-Off release process

## Environments

| Environment | Branch | Frontend | Worker | Data |
| --- | --- | --- | --- | --- |
| Production | `main` | `https://squeebmike.github.io/ArSca/` | `still-resonance-4f87` | Production Supabase, KV, and R2 |
| Beta | `beta` | `https://arsca-beta.pages.dev/` | `walkoff-beta` | Separate beta Supabase, KV, and R2 |

Never point the beta deployment at the production Supabase project. The beta workflow rejects the known production project URL.

## Daily development

1. Make all new application changes on `beta`.
2. Push `beta`; the isolated beta site and Worker deploy automatically.
3. Test login, research, inventory, intake, checkout, receipts, and scanner behavior using beta-only stores.
4. Keep unfinished database migrations in beta until their rollback has also been tested.

## Release

1. In GitHub Actions, run **Prepare production release** and enter a semantic version such as `v1.1.0`.
2. Review the generated `beta` → `main` pull request.
3. Complete `TESTER_RELEASE_CHECKLIST.md` against the beta URL.
4. Merge the pull request. Production deploys from `main` only.
5. Create a GitHub release/tag on the merge commit.
6. Confirm production login, one search, inventory load, and a no-charge checkout rehearsal.

## Rollback

Do not rewrite `main`. Revert the release merge through a pull request, or redeploy the previous GitHub tag. Worker versions remain available through Cloudflare's version history and can be rolled back independently.

## Required protected `beta` environment secrets

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `BETA_SUPABASE_URL`
- `BETA_SUPABASE_ANON_KEY`
- `BETA_SUPABASE_SERVICE_ROLE_KEY`
- `POKEMONPRICE_API_KEY` (optional until beta Pokémon testing is needed)
- `PRICECHARTING_TOKEN` (optional until beta PriceCharting testing is needed)
- `COMICVINE_API_KEY` (optional until beta comics testing is needed)

Production secrets remain separate and are never copied into the beta frontend.

After the protected environment secrets are saved, create the repository variable `BETA_READY=true`. Until then, pushes to `beta` are intentionally skipped so an incomplete beta deployment cannot consume runner time or reach production data.
