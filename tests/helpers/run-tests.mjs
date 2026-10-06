// `npm test` runs the whole suite (the test:all script) with the
// dashboard-source preload active, so tests that read dashboard.html see the
// app code inline (see dashboard-source-hook.mjs). Scoped to the test run on
// purpose: as a repo-wide .npmrc node-option it also loaded into `npx
// wrangler` during the Worker deploy and broke it.
import { spawnSync } from 'node:child_process';

const hook = new URL('./dashboard-source-hook.mjs', import.meta.url).href;
const env = { ...process.env, NODE_OPTIONS:[process.env.NODE_OPTIONS, '--import=' + hook].filter(Boolean).join(' ') };
const result = spawnSync('npm', ['run', 'test:all'], { stdio:'inherit', env, shell:process.platform === 'win32' });
process.exit(result.status ?? 1);
