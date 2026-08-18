# The Mana Pocket Phone + SMS System — Planning Notes

Status: **MILESTONE-ONE + TWO SHIPPED, AWAITING YOUR TWILIO CONSOLE SETUP** —
all code built, tested, and merged to main. Milestone-one (2026-08-19 →
2026-08-20) built the ring group, browser softphone, and message inbox.
Milestone-two (2026-08-20) added voicemail, business-hours-aware routing,
and a PHONE SETTINGS panel. Neither will do anything live until you complete
the manual steps in "What you need to do" below — that section now covers
both milestones' setup in one place.

## Answers to the open questions (2026-08-19)

1. **Multi-tenant scope: single-tenant.** Just The Mana Pocket runs on this
   dashboard/worker today. No other real shop needs isolation from this store's
   ring group/phone identities. Schema still carries `store_id` for consistency
   with the rest of the app's pattern, but no complex per-store TwiML App/SIP
   Domain provisioning is needed -- one shared TwiML App/Voice identity scheme
   scoped to this one store is sufficient.
2. **Personal-phone forwarding: stays forever, permanent backup.** The existing
   blind-relay-to-personal-phones behavior (voice ring-all + SMS relay) keeps
   running indefinitely alongside the new browser softphone/inbox, not just
   during rollout. New `<Client>`/inbox functionality is ADDITIVE to the
   existing `<Number>` ring-all, never a replacement.
3. **Scope for the unattended overnight build: milestone-one only.** Schema,
   webhooks, browser softphone, expanded-but-preserved ring group, outbound
   calling, Call From My Phone, SMS/MMS with real persistence. Voicemail,
   business hours, and the full settings UI are separate follow-on milestones.
   The SIP desk phone is deferred indefinitely -- the user doesn't own the
   physical device yet, so there's nothing to register/test it against.

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

## Milestone-one: SHIPPED (built unattended overnight, 2026-08-19 → 2026-08-20)

All of it is merged to `main`: Supabase schema, Worker routes, dashboard PHONE
tab. It will not do anything live yet — see "What you need to do" below —
but every piece of code is written, tested, and deployed as code.

### What actually got built

- **Schema** (`supabase-migrations/2026-08-19-phone-system.sql`, not yet run
  against the live database — see below): `phone_endpoints` (per-staff browser-
  calling opt-in, deterministic Client identity, and the employee's own
  approved mobile for Call From My Phone), `calls`, `messages`. Store-scoped,
  RLS-gated by the existing role system — **no new granular
  `phone.read`/`phone.call`/etc. permissions** were built, because this app
  has no granular permission system anywhere; phone routes are gated by role
  exactly like every other operational route (`requireStoreUser(..., ['owner',
  'admin','manager','employee'])`).
- **Worker** (`cloudflare-worker-full.js`):
  - `/twilio/voice` now Dials the existing personal numbers AND every
    enabled browser `<Client>` identity in one `<Dial>` — additive, ring-all,
    first-answer-wins, exactly as before for the personal-number legs. A
    `<Dial action>` callback (`/twilio/voice-dial-complete`) logs the outcome
    exactly once per call no matter how many legs rang, so there's no
    duplicate missed-call noise, and no separate per-leg table was needed.
  - `/twilio/sms` now persists every inbound message before relaying it to
    personal phones — the existing blind relay keeps running forever, per
    your answer.
  - `/api/phone/token` issues a real Twilio Access Token (hand-rolled
    HS256 JWT via Web Crypto — Twilio has no Workers-compatible SDK, so this
    was built from the public Access Token spec and independently verified
    in tests by re-deriving and checking its HMAC-SHA256 signature, but it
    has never touched a real Twilio account).
  - `/twilio/voice-outbound-app` is the TwiML App's own Voice Request URL,
    for direct browser-to-PSTN dialing (`device.connect()`) — a quicker
    alternative to the two-leg bridge below.
  - `/phone/call-from-my-phone` implements "Call From My Phone": calls the
    AUTHENTICATED employee's own saved `approved_mobile` (server-side lookup
    only, never anything the browser sends), then on answer bridges to the
    customer with the business number as caller ID. This is the toll-fraud
    guard the original spec called out as the real risk, and it's covered by
    a dedicated test asserting the browser can never influence the bridge-
    back number.
  - `/phone/endpoints` (GET/POST), `/phone/calls`, `/phone/messages`,
    `/phone/sms/send` round out what the dashboard needs.
- **Dashboard**: new PHONE tab (in the "MORE" menu, alongside Pull Lists/FOC),
  gated for owner/admin/manager/employee same as the backend. Browser
  softphone via the Twilio Voice JS SDK (persistent `Twilio.Device`,
  survives tab switches, incoming-call popup with Accept/Decline), call
  history + message list (both click-to-call), a "send a text" box, a "Call
  From My Phone" box, and an "enable browser calling" toggle + "my mobile
  number" field.
- **Tests**: `tests/twilio-call-sms-relay.test.mjs` rewritten for the new
  `/twilio/*` shapes, `tests/phone-system-backend.test.mjs` (route gating,
  the toll-fraud guard, a full JWT round-trip verification) and
  `tests/phone-system-dashboard.test.mjs` (tab wiring, click-to-call) added.
  Full suite green.

### What you need to do for milestone-one (I cannot do any of this myself)

1. **Run the migration** against your live Supabase project:
   `supabase-migrations/2026-08-19-phone-system.sql` (SQL editor, or however
   you normally run these). It only creates new tables — nothing existing is
   touched.
2. **Create a Twilio API Key** (Console → Account → API keys & tokens →
   Create API key, Standard type). Save the SID and Secret — the Secret is
   only shown once.
3. **Create a TwiML App** (Console → Voice → TwiML → TwiML Apps → Create new
   TwiML App). Set its **Voice Request URL** to
   `https://<your-worker-domain>/twilio/voice-outbound-app` (POST). Save the
   App SID.
4. **Add three new Worker secrets** (`wrangler secret put`, same as the
   existing `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER` —
   those three already exist and don't need to change):
   - `TWILIO_API_KEY_SID`
   - `TWILIO_API_KEY_SECRET`
   - `TWILIO_TWIML_APP_SID`
   Do this for whichever `wrangler.*.jsonc` environment(s) you deploy to.
5. **Nothing else changes on the Twilio number itself** — its Voice/SMS
   webhook URLs stay exactly `/twilio/voice` and `/twilio/sms`, unchanged.
6. **Test it**: open the PHONE tab, flip "Ring this browser" on, fill in your
   mobile number, hit Save. Status should go to "Ready — this browser will
   ring." Call the store's Twilio number from another phone — your personal
   phones should ring exactly as before, AND an incoming-call popup should
   appear in the browser. Try "Call From My Phone" with a real number, and
   sending a text.

### Known limitations / deliberate scope trims (milestone-one)

- **No SIP desk phone** — separate follow-on milestone; you don't own the
  hardware yet, so there's nothing to build that against. (Voicemail,
  business hours, and a settings UI were originally deferred here too, but
  shipped in milestone-two below.)
- **No granular `phone.*` permissions** — role-gated like everything else in
  this app (see schema note above). If you want per-person granular control
  later, that's new territory for this codebase, not an existing pattern to
  extend.
- **Customer-number matching** (for showing a caller's name instead of just
  their number) is a capped, unindexed client-side filter over up to 1,000
  customers — fine for one shop, would need a real indexed lookup if the
  customer list ever gets much bigger.
- **The browser device only connects once you've visited the Phone tab with
  the toggle on this session** — there's no always-on background connection
  at login yet (deliberately, to avoid a surprise mic-permission prompt for
  everyone on every login).
- **Click-to-call is only wired into the Phone tab's own call/message
  lists**, not swept across Customer Browse or anywhere else a phone number
  appears elsewhere in the dashboard — that fuller sweep is a follow-up.
- **Per-leg "who answered" isn't tracked** beyond the overall ring-all
  outcome (answered/no-answer/busy/failed) — deliberate, since Twilio's own
  `<Dial action>` semantics already solve the "no duplicate missed-call
  noise" requirement without a separate per-leg table; you just won't see
  "answered by Jane's cell" vs. "answered by the browser" specifically.
- **`buildTwilioAccessToken` has never touched a real Twilio account** — its
  JWT structure was independently verified in tests (re-derived and checked
  the HMAC-SHA256 signature by hand), but the very first real token issuance
  after you add the secrets is the actual proof. Watch it closely.

## Milestone-two: SHIPPED (2026-08-20) — voicemail, business hours, settings UI

Built after you asked "do we need voicemail set up with what we have now?
business hours? settings UI?" — the answer was: not required, but a real gap
(an unanswered call before this just went dead silent, no way for a caller
to leave a message). This closes that gap.

### What actually got built

- **Schema** (`supabase-migrations/2026-08-20-phone-voicemail-business-hours.sql`):
  `phone_settings` (one row per store — voicemail on/off, greeting text,
  after-hours message, `business_hours` jsonb, timezone) and `voicemails`
  (recording metadata; the actual audio stays hosted on Twilio, never
  mirrored into Supabase storage). Same RLS pattern as `calls`/`messages` —
  staff-readable, service-role-writes-only, and `phone_settings` writes are
  additionally owner/admin-gated at the Worker route level (ring-group
  policy is a store-wide decision, not a per-employee one).
- **Worker**:
  - `/twilio/voice` now loads `phone_settings` and checks `isStoreOpenNow()`
    (a pure `Intl.DateTimeFormat`-based day/time check, fails OPEN on any
    error or malformed config) before ringing anyone. Closed → closed
    message, then `<Record>` for voicemail if enabled. An **empty/unset
    `business_hours` means always-open** — this is the exact milestone-one
    behavior, so a store that never visits the new settings panel sees zero
    change.
  - On no-answer (`/twilio/voice-dial-complete`), same voicemail fallback —
    the greeting text is threaded through as a query param from the initial
    `/twilio/voice` response rather than re-fetched, so no extra Supabase
    round trip is added to a call a real person is waiting on.
  - New `/twilio/voice-voicemail-recording` webhook (the `<Record>`
    callback) persists the finished recording and marks the original call
    row `status: 'voicemail'`.
  - New authenticated routes: `GET/POST /phone/settings` (POST is
    owner/admin only), `GET /phone/voicemails`, `POST
    /phone/voicemails/mark-heard`, `GET /phone/voicemail-audio` (a
    Basic-Auth proxy to Twilio's recording media — the dashboard never
    holds the Twilio Auth Token client-side).
- **Dashboard**: PHONE SETTINGS panel (owner/admin only) inside the PHONE
  tab — voicemail on/off, greeting + after-hours message text, a 7-day
  hours grid with a master "restrict to business hours" toggle (off by
  default = ring 24/7, so saving without touching anything never silently
  narrows your hours), and a timezone picker. New VOICEMAILS panel
  alongside Recent Calls/Messages — click PLAY to fetch+play the recording
  (via the authenticated proxy, marks it heard automatically).
- **Tests**: extended `tests/twilio-call-sms-relay.test.mjs` and
  `tests/phone-system-backend.test.mjs` for the new routing/voicemail/hours
  logic (including functional tests of `isStoreOpenNow` covering the
  always-open default, explicit-closed days, omitted-day-means-closed, and
  fail-open-on-garbage-input behavior), extended
  `tests/phone-system-dashboard.test.mjs` for the new panel and voicemail
  list. Full suite green.

### What you need to do for milestone-two specifically

1. **Run the new migration**:
   `supabase-migrations/2026-08-20-phone-voicemail-business-hours.sql`.
   Only creates new tables — nothing existing is touched, no changes needed
   to milestone-one's setup.
2. **That's it** — no new secrets, no Twilio Console changes. Voicemail
   uses your existing Twilio credentials; `<Record>` is a TwiML verb, not a
   separate product to enable.
3. **Test it**: open PHONE → PHONE SETTINGS (owner/admin only). Leave
   business hours off and confirm voicemail-on-no-answer works (call the
   store number, don't answer anywhere, wait ~20s, leave a message — it
   should show up in VOICEMAILS with a NEW badge and a working PLAY
   button). Then turn business hours on, set today's window to something
   already in the past, and confirm a fresh call goes straight to the
   closed message/voicemail instead of ringing.

### Known limitations / deliberate scope trims (milestone-two)

- **No transcription** — voicemails are audio-only; you have to listen to
  each one. Twilio does offer transcription as an add-on if you want it
  later.
- **One business-hours schedule for the whole store** — no per-line, no
  holiday-date overrides, no "different hours next week" — just a
  recurring weekly Mon–Sun grid.
- **The recording proxy fetches on every play**, no caching — fine at this
  volume, would want to think about it if voicemail volume ever got heavy.
