import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'dist-beta');
const required = ['BETA_WORKER_URL', 'BETA_SUPABASE_URL', 'BETA_SUPABASE_ANON_KEY'];
const missing = required.filter(name => !String(process.env[name] || '').trim());
if (missing.length) throw new Error(`Missing beta configuration: ${missing.join(', ')}`);

await fs.rm(out, { recursive:true, force:true });
await fs.mkdir(out, { recursive:true });
for (const file of ['index.html','dashboard.html','sca.html','admin.html','.nojekyll','2026_topps_s1_baseball.json']) {
  await fs.copyFile(path.join(root, file), path.join(out, file));
}
await fs.cp(path.join(root, 'scripts'), path.join(out, 'scripts'), { recursive:true });

let config = await fs.readFile(path.join(root, 'app-config.js'), 'utf8');
config = config
  .replace("channel:'production'", "channel:'beta'")
  .replace("workerUrl:'https://still-resonance-4f87.swarnerauto.workers.dev'", `workerUrl:${JSON.stringify(process.env.BETA_WORKER_URL)}`)
  .replace("supabaseUrl:'https://vroknjrxubsqyexngwus.supabase.co'", `supabaseUrl:${JSON.stringify(process.env.BETA_SUPABASE_URL)}`)
  .replace("supabaseAnonKey:'sb_publishable_wbpX2nL8l-4NbXtZNG_bjA_nabSYaJ5'", `supabaseAnonKey:${JSON.stringify(process.env.BETA_SUPABASE_ANON_KEY)}`);
await fs.writeFile(path.join(out, 'app-config.js'), config);
console.log(`Built isolated beta site in ${out}`);
