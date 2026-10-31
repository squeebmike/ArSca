// The Worker imports `cloudflare:workers` (Live Studio's Durable Object,
// scripts/live-studio-room.mjs). Cloudflare provides it; plain Node -- the
// test suite and the deploy workflow's checks, which import the Worker --
// can't load a cloudflare: URL. This preload answers it with a minimal
// stand-in (a DurableObject base class that keeps ctx/env, as Cloudflare's
// does), so importing the Worker works outside Cloudflare. Nothing here
// runs in production: wrangler bundles the real module.
import { register } from 'node:module';

const STUB = 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }\n'
  + 'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }\n'
  + 'export class RpcTarget {}\n';
const hooks = `
export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: 'cloudflare-stub:workers', shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url === 'cloudflare-stub:workers') return { format: 'module', source: ${JSON.stringify(STUB)}, shortCircuit: true };
  return next(url, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hooks));
