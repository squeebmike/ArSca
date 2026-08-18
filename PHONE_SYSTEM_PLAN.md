# The Mana Pocket Phone + SMS System — Planning Notes

Status: **ON HOLD** — spec received and audited 2026-08-18, no implementation started.
Resume by answering the two open questions below, then proceed with the milestone-one plan.

## The ask

Full spec from the user: build a complete internal business phone system into the
existing dashboard — Twilio Programmable Voice, Voice JS SDK (browser softphone),
Programmable Messaging, SIP Registration/SIP Domain for a physical desk phone,
integrated with existing Supabase customer/staff data. Core requirements:

- Preserve existing owner/manager personal-phone call forwarding — do not break it.
- Expand the ring group to also ring a browser softphone and a SIP desk phone,
  simultaneously, first-answer-wins, without creating duplicate "missed call" noise
  from unanswered sibling legs (parent/child CallSid tracking).
- Full call history, SMS/MMS history with a real conversation UI, voicemail.
- Click-to-call / click-to-text from anywhere a customer phone number appears.
- **"Call From My Phone"**: owner/manager clicks a button, Twilio calls their own
  approved mobile first, they answer, Twilio then calls the customer and bridges
  the two legs — customer sees the business number, never the employee's personal
  number, and the browser can never supply an arbitrary callback number (toll-fraud
  guard — this must be server-derived from the authenticated employee only).
- Customer identification on inbound calls/texts via existing customer records.
- Staff permissions (`phone.read`, `phone.call`, `phone.text`, `phone.voicemail`,
  `phone.admin`), business-hours-aware routing, extensible to future staff/endpoints.
- The full spec text (very long, verbatim) is preserved in this session's transcript
  if the exact original wording is ever needed again — not reproduced here.

The user's own instructions were explicit: audit first, do not rebuild the dashboard,
do not replace the current architecture, do not touch Twilio Console config blindly,
and — repeated multiple times in the spec — **do not break the existing owner/manager
call forwarding under any circumstances.**

## Audit findings — what actually exists today

All Twilio logic lives in one place: `cloudflare-worker-full.js`, added recently
(git log, newest first):

```
e9a86a6 Add whisper announcement to forwarded store calls
82be12f Add Twilio/SendGrid config flags to /health
349c254 Make SMS consent checkboxes optional, not submission-blocking
4de7bc2 Complete SMS-consent checkboxes per Twilio's exact web-form requirements
8d584d6 Add explicit SMS-consent checkboxes to public phone-collecting forms
93a9686 Add inbound call forwarding + SMS relay on the store's Twilio number
8cbf243 Add real SMS/email sending (Twilio + SendGrid) to Want List notify
```

No mention of this system anywhere in `cloudflare-worker-updates.md`,
`KNOWN_ISSUES.md`, `RELEASE_PROCESS.md`, `BUG_TRACE_REPORT.md`, or
`DATA_MODEL_NOTES.md` — the only documentation is inline code comments and
`tests/twilio-call-sms-relay.test.mjs`.

### Routes (all POST, unauthenticated — identity comes from a `?store=<uuid>` query param)

- `POST /twilio/voice` — Twilio's "a call comes in" webhook.
- `POST /twilio/voice-whisper` — whisper leg played to whoever picks up, before bridging
  (works around `<Dial><Number>`'s default caller-ID passthrough, which otherwise makes
  a forwarded store call indistinguishable from a normal personal call).
- `POST /twilio/sms` — Twilio's "a message comes in" webhook.
- **No status-callback route exists.** Calls and texts are fire-and-forget; nothing
  records outcome anywhere.

### Exact current inbound-voice logic (`cloudflare-worker-full.js` ~line 10564+)

```js
async function handleTwilioWebhook(request, env, url) {
  const storeId = String(url.searchParams.get('store') || '').trim();
  const rawBody = await request.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));
  const sigOk = await verifyTwilioSignature(request.url, params, request.headers.get('X-Twilio-Signature') || '', env.TWILIO_AUTH_TOKEN);
  if (!sigOk) return new Response('Invalid signature', { status: 403 });
  // ...store-id shape check, Supabase configured check...
  const { data: settings } = await supabaseAdminFetch(env, `store_settings?store_id=eq.${storeId}&select=receipt_settings&limit=1`);
  const numbers = (settings?.[0]?.receipt_settings?.notifyForwardNumbers || []).filter(Boolean).slice(0, 5);
  const storeName = settings?.[0]?.receipt_settings?.shortName || settings?.[0]?.receipt_settings?.storeName || '';

  if (url.pathname === '/twilio/voice') {
    if (!numbers.length) return twimlResponse('<Response><Say>Sorry, no one is available...</Say></Response>');
    const whisperUrl = `${url.origin}/twilio/voice-whisper?store=${storeId}`;
    const dialNumbers = numbers.map(n => `<Number url="${whisperUrl}">${n}</Number>`).join('');
    return twimlResponse(`<Response><Dial timeout="20">${dialNumbers}</Dial></Response>`);
  }
  if (url.pathname === '/twilio/voice-whisper') {
    return twimlResponse(`<Response><Say>Call for ${storeName}. Connecting you now.</Say></Response>`);
  }
  if (url.pathname === '/twilio/sms') {
    const from = params.From, text = params.Body;
    for (const num of numbers) { try { await sendSms(env, num, `Text from ${from}: ${text}`); } catch (e) {} }
    return twimlResponse('<Response></Response>');
  }
}
```

Key facts:

- **One `<Dial timeout="20">` with multiple `<Number>` children** — real simultaneous
  ring-all, first-to-answer wins. No sequential/hunt routing, no per-leg timeout, no
  voicemail fallback if nobody answers (call just ends).
- **Numbers are NOT hardcoded** — read live from Supabase on every call
  (`store_settings.receipt_settings.notifyForwardNumbers`, a jsonb array), capped at
  5 in the worker.
- **No caller-ID control** — Twilio's default `<Number>` behavior passes the original
  caller's number through; the whisper is the only workaround that exists today.
- **No recording, no voicemail, no queueing, no business hours, no per-agent routing.**
  This ring-all-with-a-whisper is the entire voice feature.

### SMS

- Inbound (`/twilio/sms`, above): blind relay of `Text from {From}: {Body}` to every
  forwarding number, independently (one failure doesn't block the rest). **Nothing is
  persisted anywhere** — no table write of any kind for inbound SMS content.
- Outbound primitive, `sendSms()` (~line 10522): plain Basic-Auth REST call to
  Twilio's `Messages.json` endpoint. Shared with the unrelated Want-List notify
  feature (`sendContactNotification()` picks SMS vs. email by whether the contact
  string contains `@`). Outbound messages aren't persisted either.

### Env vars / secrets — platform-level, not per-store

`env.TWILIO_ACCOUNT_SID`, `env.TWILIO_AUTH_TOKEN`, `env.TWILIO_FROM_NUMBER` — set via
`wrangler secret put`, **not** declared in `wrangler.deploy.jsonc` or
`wrangler.beta.jsonc` (checked both, neither has any Twilio key in its `vars` block).

**This is one shared Twilio account/number for the entire platform**, not one per
store. Per-store behavior is achieved only via the `?store=` query param + the
`notifyForwardNumbers` JSON — there is no concept of "this store's own number/subaccount."
`/health` reports `twilio: !!(ACCOUNT_SID && AUTH_TOKEN && FROM_NUMBER)` as a config
flag (added in `82be12f`) so this can be checked without a live route.

### Signature verification — solid, correctly implemented

`verifyTwilioSignature()` implements Twilio's real signing scheme (URL + sorted
key+value pairs, HMAC-SHA1 with the auth token, base64, constant-time compare via
the same `constantTimeEqualHex()` helper already used for Stripe's webhook verifier).
Fails closed on missing token/header. Checked *before* any Supabase read or SMS send.
Confirmed correct against `tests/twilio-call-sms-relay.test.mjs`'s real HMAC-computed
test cases (valid signature accepted, forged signature rejected, missing token rejected).

### Supabase — no dedicated tables exist

No `calls`, `messages`, `conversations`, or `voicemails` table anywhere in
`supabase-migrations/` or `supabase/`. The only table involved is the pre-existing
generic `store_settings`:

```sql
create table if not exists public.store_settings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references public.stores(id) on delete cascade,
  payment_settings jsonb not null default '{}'::jsonb,
  modules jsonb not null default '{}'::jsonb,
  theme jsonb not null default '{}'::jsonb,
  receipt_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`notifyForwardNumbers` and `shortName`/`storeName` live **nested inside the
`receipt_settings` jsonb column** — no dedicated columns, no separate table. A
persistence layer for calls/messages/voicemail needs to be designed from scratch;
there's nothing to extend.

### A real, already-demonstrated fragility to design around

`receipt_settings` is saved via full-replace `upsert()` from **two independent
dashboard functions** (`saveVendorProfile()` and `savePaymentSettings()`), each of
which must re-send the *entire* `receipt_settings` object on every save or the other
function's last write gets silently erased — since a jsonb column upsert replaces
the whole column, not a merge. Code comments and
`tests/twilio-call-sms-relay.test.mjs` (asserts `notifyForwardNumbers` appears in
*both* whitelists) confirm this already caused a real bug once. **Any new
routing/endpoint config added to this system must go into both whitelists
identically, or it will silently vanish on the next unrelated settings save.**

### Dashboard UI today

Settings-only: a "CALL FORWARDING & TEXT RELAY" panel with **3** phone-number inputs
(`dashboard.html` ~line 6631) — note the UI caps at 3 while the worker supports up to
5, a small pre-existing mismatch — a save button, and read-only webhook URLs
(`.../twilio/voice?store=...`, `.../twilio/sms?store=...`) for the store owner to
copy-paste into Twilio's console by hand. **No call log, no message/SMS inbox, no
click-to-call/click-to-text anywhere.** Twilio number/webhook setup is entirely
manual per store today — no programmatic provisioning.

### Test coverage

`tests/twilio-call-sms-relay.test.mjs` is a source-regex contract test (string-matches
expected patterns directly against the worker/dashboard source, not a runtime/behavioral
test). It thoroughly covers what exists today (routing, signature verification, exact
TwiML shape, the dual-whitelist requirement, XML-escaping of attacker-controlled
`From`/`Body` before embedding in hand-built TwiML). **Because it matches literal
source patterns, any structural refactor of this code will very likely break this
test even when behavior is preserved** — it will need a substantial rewrite (not just
extension) alongside any real restructuring, not a patch.

## Open questions — need answers before designing the schema/routing

1. **Multi-tenant scope.** The Twilio credentials are platform-level secrets shared
   by the whole Worker, and the surrounding app is built store-scoped throughout (a
   `stores` table, per-store RLS, `getActiveStoreId()` everywhere). Is this
   genuinely single-tenant (just The Mana Pocket), or do other real shops run on this
   same dashboard/worker? If multi-tenant in practice, every new TwiML App / Voice
   grant identity / SIP domain must be scoped per-store from day one, or one store's
   employee could register into another store's ring group. This is the single
   biggest thing that changes the design — needs an answer before any schema work.

2. **Does personal-phone forwarding stay forever, or just during rollout?** Once a
   real message inbox exists, should the current "blind-relay every inbound text to
   personal phones" behavior stop, or keep running as a backup notification
   alongside the new inbox? Same question for voice: once the browser/SIP endpoints
   are in the ring group, is ringing the owner's/manager's personal phones a
   permanent fixture, or was it always meant to fall away once the new system is
   trusted? Changes how the ring-group config and SMS-relay logic should be modeled.

## My assessment of the spec

- Well-written and mostly right on security posture (esp. "Call From My Phone":
  server derives the employee's approved mobile from config, browser never supplies
  a callback number — correct instinct, this is the real toll-fraud surface here,
  not the SIP phone).
- **Too large as a single unit of work.** The spec's own phases 1–9 (audit, schema,
  webhooks, browser softphone, preserved+expanded ring group, dashboard outbound
  calling, Call From My Phone, SMS/MMS with real persistence) are a coherent
  milestone-one. Phases 10–15 (voicemail, SIP desk phone, business hours, full
  settings UI, transcription) are each their own project and should ship as
  separate, independently-reviewable follow-ons rather than one enormous change.
- **SIP desk phone is infrastructure, not code** — Twilio SIP Domain/Credential List
  config can be built and documented, but a physical device actually registering and
  ringing needs the user in the loop with a real phone on hand. Treat as a late,
  separate milestone.
- The existing regex-based test file will need a substantial rewrite (not an
  extension) the moment the TwiML-building logic changes shape.

## Recommended next step (when resumed)

1. Get answers to the two open questions above.
2. Propose a concrete milestone-one plan: Supabase schema (calls/call_legs/
   conversations/messages/phone_endpoints, properly store-scoped depending on Q1),
   secure `/api/phone/token` endpoint, browser Voice SDK integration with a
   persistent phone provider (survives route navigation), expanded-but-preserved
   `<Dial>` ring group (add browser + eventually SIP as more `<Number>`/`<Client>`/
   `<Sip>` nouns alongside the existing personal numbers — first-answer-wins,
   parent/child CallSid tracked so unanswered sibling legs don't produce duplicate
   missed-call records), dashboard outbound calling, Call From My Phone (two-leg
   bridge, server-only callback number), SMS/MMS with real conversation persistence
   and realtime updates.
3. Ship that as its own tested, reviewable unit — following this repo's established
   pattern (edit → parse-check → tests → version bump → commit/push → merge to main)
   — before starting voicemail/SIP-phone/business-hours/settings-UI as separate
   follow-on milestones.
