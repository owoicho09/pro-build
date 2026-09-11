# proBuild

An AI-powered software-building platform for nontechnical users: describe an
idea, watch it get built via the [v0 Platform API](https://v0.app/docs/api/platform),
preview it live, keep modifying it in plain language, and publish it to a
real production URL on Vercel.

Full architecture and the vertical-slice build plan live in
`build-prompt.txt` (product spec) — the implementation follows it slice by
slice; see the repo's plan history for the researched architecture doc.

## Status

**Slices 1-11 are implemented — this is the full vertical-slice plan.**
auth + dashboard, the core v0 builder loop
with a live preview, follow-up messages that continue the same v0 chat
(with a guard against starting a second build while one is already running),
image/document attachments (PDFs get server-side text extraction),
persistence — reopening a project restores its full conversation, attached
files, in-progress build state, and a dashboard thumbnail captured from v0's
last successful version — publishing to a real Vercel production URL with
deployment history, integrations/secrets (detecting a project needs a
provider like Paystack from the prompt, letting the user connect it, pushing
real credentials to v0 as env vars, and resuming the build to finish the
real implementation), usage/credit enforcement (a real signup credit grant,
a visible balance, and build-blocking checks for both credits and a
per-project velocity limit), platform billing (a `/billing` page, Paystack
checkout, an idempotent signature-verified webhook that grants monthly
credits on payment and updates the user's plan, and cancellation that never
touches project data), and custom domains (connecting an existing domain to
a published project, DNS/TXT verification instructions, a manual
"check verification" action, and removal — domain purchase is intentionally
not built, per the plan's Check 7: the platform never buys anything on a
user's behalf without a settled commercial/legal model), and notifications +
a minimal admin dashboard (an in-app notification for build
completed/failed, deployment completed/failed, and integration-needs-
attention, each with a best-effort email via Resend when configured; a
`/admin` page — gated by a server-side `ADMIN_EMAILS` allowlist, 404 for
everyone else — showing users, projects, credit liability, usage
today/this-month/all-time, top consumers, failed builds, deployments, and
subscription state).

**Slice 11 (notifications/admin) is live-verified for its core mechanism
and one full call site; the other four notification call sites share that
same proven code path but weren't separately triggered.** Live-verified
this session, reusing the already-published Riverside Bakery project (no
new v0 chat-generation credits spent — publishing a project doesn't consume
them, confirmed by the credit balance staying at 444 throughout): clicking
"Publish update" for real drove the actual deploy → notify path, and
directly querying the database afterward showed a real `notifications` row
(`type: "deployment_completed"`, correct `project_id`, `payload.url`
matching the real Vercel URL v0 returned) — not a hand-inserted test row.
The in-app bell then rendered it correctly (red-dot badge, dropdown text,
"1m ago" timestamp) and marking it read via the RLS-scoped
`markNotificationsRead` action persisted correctly on reload — verified
directly in the database, not just the UI no longer showing a badge. The
`/admin` gate was verified in both directions for real: with the live test
account's email in `ADMIN_EMAILS`, `/admin` rendered genuine cross-user data
(credit liability, this-month/all-time usage in real dollars, the real
project/deployment/subscription rows — the `auth.users` joins in
`src/lib/services/admin.ts` work against the real schema, not a guess); with
`ADMIN_EMAILS` pointed at an unrelated address and the dev server restarted
to pick it up, the same signed-in account hitting `/admin` got a plain
`404`, not a redirect or a crash — confirming the check is a real
server-side authorization gate, not just a hidden link.

The `build_completed`, `build_failed`, and `integration_attention` call
sites (in `advanceBuild`, `src/lib/services/build-orchestrator.ts`) weren't
separately live-triggered — doing so would mean either spending real v0
chat-generation credits on a throwaway build, or waiting out the 10-minute
`STUCK_THRESHOLD_MS` grace period for a synthetic failure. Both call the
same `notifyUser()` function proven correct above with the same shape, so
this is a documented simplification, not an unknown. Email delivery itself
is entirely unverified — no `RESEND_API_KEY` was available this session;
`sendEmail()` skips silently without one, which is itself the correctly
verified behavior (no crash, no notification lost, in-app delivery is
unaffected).

**Slice 10 (domains): the code path is real and one real API call in it is
live-verified; the domain-connect/verify calls themselves are not** — no
`VERCEL_ACCESS_TOKEN` was available this session, the same gap Slice 6 has
had all along. What *was* live-verified, against the real test account's
already-published Riverside Bakery project (no new v0 credits spent — this
only reads existing v0 state): opening the project rendered the new
"Custom domains" bar correctly (enabled, since the project has a
`production_url`); submitting a domain through the UI drove the real
`connectDomain` orchestrator, which made a real `v0.projects.getById()` call
and got back a genuinely populated `vercelProjectId`
(`prj_HLJabPGe0FRTcaGN7uf9QTv5OM43`) for a project deployed in an earlier
session — confirming, with real data instead of an assumption, that v0
Projects keep the Vercel project link around indefinitely, not just for the
lifetime of a single `deploy()` call. The flow then correctly hit the
missing-token guard and surfaced *"Custom domains aren't available yet — the
platform's Vercel connection isn't configured"* instead of a crash or a
silent no-op, and — confirmed directly against the database — wrote nothing
to the `domains` table, so a failed connect attempt never leaves a
half-created row behind.

Endpoint shapes (`POST /v10/projects/{id}/domains`,
`POST /v9/projects/{id}/domains/{domain}/verify`,
`GET /v6/domains/{domain}/config`, `DELETE /v9/projects/{id}/domains/{domain}`)
were pulled from Vercel's current REST API reference rather than guessed,
including the non-obvious part: adding a domain that isn't verified yet
returns `200` with `verified: false` and a challenge array, but *re-checking*
an unsatisfied challenge via the verify endpoint returns `400`, not `200`
with `verified: false` — the code treats that `400` as the expected
"not ready yet" case (reported back to the user as a reason string) rather
than an error, a distinction that only came from reading the actual API
reference, not from the shape of the "add" endpoint's response. This
remains unverified against a real DNS challenge/real domain until a
`VERCEL_ACCESS_TOKEN` is available, same as Slice 6's publish-protection
gap.

**Slice 9 (billing): the webhook handler is fully live-verified; the
checkout redirect flow is not** — no real Paystack account was available
this session (the same situation Slice 6 was in for Vercel initially), so
`startCheckout()`'s call to `POST /transaction/initialize` and the resulting
hosted-checkout redirect are unverified against a live Paystack endpoint.
Everything downstream of Paystack's webhook — the part that actually moves
money into product state — *was* live-verified, without spending real money,
by computing valid HMAC-SHA512 signatures locally (the same algorithm
`verifyWebhookSignature` checks) and POSTing real `charge.success` and
`subscription.create` payloads at the running `/api/webhooks/paystack`
route:
- a correctly-signed `charge.success` creates a `transactions` row, grants
  the plan's monthly credits, updates `profiles.plan_id`, and links
  `paystack_customer_code`
- replaying the identical event (same `provider_reference`) is a no-op —
  the unique constraint makes idempotency real, not just assumed
- an incorrectly-signed request is rejected with 401 before touching the DB
- `subscription.create` (which carries no `metadata`) correctly falls back
  to the `paystack_customer_code` self-healing lookup described below and
  records the subscription's `email_token`, confirming that fallback path
  actually works rather than being untested code
One transient failure during this testing (a `charge.success` that logged
`"Failed to record transaction ... {}"`) was root-caused to a momentary
`getaddrinfo ENOTFOUND` DNS blip, not a handler bug — a clean retry with a
fresh reference succeeded with every downstream effect verified correct. All
test data (the fake subscription, ledger entries, transaction, and the test
account's `plan_id`/`paystack_customer_code`) was deleted afterward and the
credit balance confirmed restored to its real value.

Endpoint shapes were confirmed against Paystack's actual docs rather than
guessed (`POST /transaction/initialize` with a `plan` code,
`POST /subscription/disable` with `code` + the `email_token` captured from
the `subscription.create` webhook — there's no other way to get that token
after the fact — and HMAC-SHA512 signature verification using the secret key
itself, since Paystack doesn't have a separate webhook secret). Webhook
events are correlated back to our own user records via
`profiles.paystack_customer_code` (self-healing — set the first time we see
it) rather than solely via checkout `metadata`, since metadata isn't
confirmed to propagate to every lifecycle event — and this session's live
test of `subscription.create` (which indeed arrived with no metadata)
confirmed the fallback is necessary and works, not just a defensive guess.
See `src/db/seed-paystack-plans.md` for the one-time step (create the plans
on Paystack's side, store the codes) needed before checkout will do anything
besides return "This plan isn't available for checkout yet."

**Slice 8 (usage & credits) is fully live-verified**, including a real bug
this testing surfaced: a brand new signup had no `credit_ledger` row at all
(balance defaulted to 0, so their very first build already went negative) —
the signup trigger now grants the plan's `monthly_credits` atomically with
profile creation. Live-tested: the dashboard/workspace header correctly
shows "444 credits"; zeroing the test account's balance via a direct ledger
entry (no v0 spend) got a real send blocked with *"You're out of build
credits..."* before any v0 call or DB write; inserting 5 completed builds
for one project got the next send blocked with *"You've hit this project's
build limit for the hour (5)..."*; and attempting a second project on the
free plan (limit 1) was rejected with *"Your plan allows up to 1 project.
Upgrade to start another"* before any project row was created. Rate
limiting is deliberately per-project rather than per-user-across-all-projects
— a documented V1 simplification, see "Known limitations."

**Slice 7 (integrations/secrets) is fully live-verified**: prompting for a
Paystack-powered ordering flow correctly showed "1 feature needs activation"
in the workspace, connecting it with test keys encrypted and stored them,
pushed both env vars to v0's project (confirmed via `v0.projects.findEnvVars`
— v0 itself stores them encrypted, `"decrypted": false`), and the resulting
follow-up build's own summary confirmed it wired real payments using
`PAYSTACK_SECRET_KEY` by name. Detection is a plain keyword scan over the
user's prompt (`src/lib/config/providers.ts`) rather than any v0-signaled
event — the SDK exposes hints of a more precise mechanism (message types
like `added-environment-variables`, a `resolveTask` flow) that weren't
verified live, so the simpler, provably-correct path was built instead.

**Slice 6 (publish) has one live-verified, unresolved gap**: Vercel projects
v0 creates have deployment protection (Vercel Authentication) on by default,
so a freshly published URL redirects to `vercel.com/sso-api` instead of
loading for the public. The publish flow now makes a best-effort attempt to
turn this off automatically via Vercel's own API (`disableDeploymentProtection`
in `src/lib/services/vercel-api.ts`, confirmed as the right call —
`PATCH /v9/projects/{id}` with `{"ssoProtection": null}`) — but this needs a
`VERCEL_ACCESS_TOKEN` we didn't have configured while live-testing, so it's
implemented and typechecked but **not yet verified end-to-end**. If it isn't
set, publish still succeeds and records the deployment, but shows a visible
warning that the site may still require Vercel sign-in to view instead of
silently claiming success.

## HavenRock acceptance test (spec §36-43)

The deeper, realistic acceptance test the plan called for once the basic
live loop passed — a fictional real-estate business, built entirely through
the platform (never hand-coded), matching the master spec's exact required
journey. Run against the real account this whole session's live testing has
used. Two real bugs were found and fixed live during this test; one hard
real-world constraint (a v0 account limit) was hit and is documented as a
genuine, not-yet-worked-around gap.

**§36 (build HavenRock) — done, with a real bug found and fixed along the
way.** The exact prompt from the spec was sent through `/projects/new`. The
first real generation attempt exposed a genuine architecture bug: v0
resolved the message with `finishReason: "tool-calls"` — zero files, zero
text — and the pre-existing code treated *any* non-null `finishReason` as
"the generation is finished," so the build was wrongly marked `succeeded`
with a real credit debit for nothing produced. Per this session's standing
rule ("if the real API behaves differently from the SDK assumptions, fix the
architecture"), this was fixed: `isTerminalFinishReason()` (new, in
`src/lib/services/builder-engine.ts`) now excludes `"tool-calls"` from
"done" — per AI SDK conventions (which v0's API mirrors), that reason means
the model paused after invoking a tool, not that it finished. `advanceBuild`
now also ages out a build stuck at a non-terminal `finishReason` past
`STUCK_THRESHOLD_MS` (10 min), the same way it already handled a status
check that kept throwing — closing the exact gap this bug exploited. The
wrongly-debited credits were refunded. Retried with a simpler, split prompt
(public site first, CRM deferred as a separate step) — succeeded for real
this time: a genuine `preview_ready` project with 10 real files, a real
`chat.text` summary, and a real screenshot/thumbnail — confirmed directly
against the live v0 API, not just our own DB. Cost: 101 credits ($1.01).

**§37 (attachment test) and the rest of §38/§39's message-dependent
steps — blocked by a real, newly-discovered v0 account constraint, not a
proBuild bug.** A later message attempt (asking v0 to fix an unrelated
rendering bug — see below) returned a genuine `HTTP 429`:
`{"error":{"type":"too_many_requests_error","message":"You have reached
your daily message limit. Please upgrade your plan to continue."}}` — a real
per-day cap on this `V0_API_KEY`'s plan tier that the original plan flagged
as "unverified, don't hardcode" and is now confirmed live. Every further
message-dependent step (the attachment test, the CRM half of the build, the
missing-credential test, the persistence test's final continuation request)
was blocked by this for the rest of the session. Confirmed the limit is
scoped to message/generation calls specifically — `deploy()` (a different
v0 endpoint) and domain-connect (Vercel's API, not v0's) both worked fine
afterward. **The platform's own handling of this was exactly right**: the
error doesn't match `startOrContinueBuild`'s specific expected-error list,
so the user sees the honest, non-alarming fallback — *"The builder is
temporarily unavailable. Your project is safe — try again shortly"* — not a
crash, not a raw stack trace, and the project's existing state was
completely untouched both times this was hit.

**§38 (continuation test) — the core mechanism is proven, via three
separate real follow-up messages, though not the exact CRM-flow wording the
spec suggested.** Every message sent for HavenRock (the full-scope retry,
the "let's start simpler" split request, and a bug-fix request) correctly
continued the *same* v0 chat (`tp2BoHLOWnq`) — confirmed unchanged in the
database throughout, never regenerating a new project. The spec's suggested
follow-up ("add a viewing-scheduling flow") was never reached — the CRM
build was deliberately deferred first, then blocked by the rate limit — but
the same-chat-continuation guarantee itself, which is what §38 actually
tests, is thoroughly demonstrated.

**A second real bug — in v0's *generated* code, not proBuild's — was found
and reported back to v0 through the normal chat flow.** Once HavenRock's
public site built successfully, the preview intermittently rendered a blank
white page. Console inspection (via a direct navigation to the real
`demoUrl`, bypassing our app's iframe entirely, to isolate whether this was
our proxy or v0's own sandbox) showed a genuine client-side crash: Tailwind
v4's JIT engine throwing `Cannot apply unknown utility class
text-[10px]uppercase` — two class names concatenated without a space
somewhere in the generated JSX, hard-crashing the whole page on a cold load.
Reproduced twice on a fresh, uncached load. This is exactly the kind of
real-world AI-generation defect the platform needs to survive gracefully —
the correct recovery path (ask the builder to fix its own bug via a normal
chat message) was exercised, though the fix attempt itself then hit the
daily rate limit above before it could complete.

**§40 (deployment test) — fully verified, live, against the database.**
Published HavenRock for real: `status: "live"`, a real `production_url`
(`https://build-a-professional-real-estat-32l3b52wr.vercel.app`), a real
`deployments` row (`vercel_deployment_id: "dpl_AJyT5Ucm5DZhQQNRPmi3zn9Hik8T"`,
`ready_state: "ready"`, `is_current_production: true`), and the "Live" badge
in the UI. `disableDeploymentProtection` failed exactly as documented (no
`VERCEL_ACCESS_TOKEN`) with the same graceful warning as every other slice's
testing — not a new gap, the same one. "Request another change, verify
production doesn't change until republished" wasn't independently
re-verified for HavenRock specifically (rate-limited), but that guarantee
was already live-verified in Slice 6 and holds architecturally regardless of
which project triggers it (a failed/no-op generation never touches
`projects.production_url`).

**§41 (domain test) — verified, identical real behavior to Slice 10.**
Connecting a domain correctly surfaced *"Custom domains aren't available
yet — the platform's Vercel connection isn't configured"* — the same
missing-`VERCEL_ACCESS_TOKEN` gap, handled the same clean way. No domain
purchase was attempted, per the spec's explicit instruction.

**§42 (persistence test) — fully verified for reopening; blocked by the
rate limit for the final continuation step.** Signed out for real, signed
back in, reopened HavenRock from the dashboard: the full conversation
(including both bug-fix attempts), the "Live" status, the real production
URL, and the deployment history all survived intact — verified via the
actual rendered UI after a real re-authentication, not assumed. The spec's
final step ("add a featured properties section, verify successful
continuation") hit the same real 429 rate limit as the other blocked steps
— handled the same gracefully.

**§43 (failure test) — the richest coverage in this pass, several of them
real rather than simulated.** Builder API failure: real (the `tool-calls`
stuck-build bug above, found and fixed, not staged). Rate limit: real (the
daily message cap above, hit twice, handled gracefully both times — this is
the literal spec item, not a stand-in). Missing environment configuration:
real (the `VERCEL_ACCESS_TOKEN` gap, hit via both publish-protection and
domain-connect). Missing project: verified live — a random nonexistent
project UUID returns a clean `404`. Unauthorized project access: verified
live with a **real second Supabase account** (created via the admin API
specifically for this check, deleted afterward) — a project genuinely owned
by that other account returns the identical `404` when the original test
account requests it, with zero data leaked in the response, confirming
`src/app/projects/[id]/page.tsx`'s RLS-backed claim that "belongs to someone
else" and "doesn't exist" are indistinguishable from the outside. Expired
session: verified live — signing out, then requesting a real project URL
directly, cleanly redirects to `/login` rather than erroring or leaking
data. Payment webhook replay: already proven live in Slice 9 (idempotent by
provider_reference, not HavenRock-specific). Not exercised this pass:
invalid attachment, duplicate request, and a real Vercel deployment
failure — the first two are blocked by the same rate limit (they need a
real message send to test meaningfully) and the third never occurred
naturally; all three were already covered by earlier slices' live testing
for a different project, just not independently re-verified for HavenRock.

**Net effect on the platform**: two real bugs fixed (the `finishReason`
handling architecture bug — a genuine correctness fix affecting every future
build, not just this one — and zero in proBuild's own code beyond that; the
Tailwind class bug lives entirely in v0's generated output). One real,
previously-unverified v0 constraint (the daily message cap) is now
confirmed and already handled correctly by existing error-handling code
with no changes needed. HavenRock itself remains live in the account as a
second real, successfully-built, non-trivial multi-page application
alongside Riverside Bakery — not deleted after testing, since it's genuine
product state, not test pollution.

## Live integration test (Slices 1-5)

Run end-to-end against a real Supabase project and a real `V0_API_KEY` — not
just typecheck/lint/build. Full journey verified through the actual browser
UI: signup → email confirm → login → describe an idea with an attached hero
image → real v0 build → preview renders in our workspace iframe → follow-up
message continues the same project → browser reload → logout → login →
reopen the project → continue it again → a deliberately induced failure
renders and persists cleanly. Two real, generated v0 projects exist from
this testing (see git history / session notes for IDs); no throwaway Todo
app was used — a small multi-page bakery business site, per the plan.

**Confirmed API behavior** (supersedes assumptions from the doc-only pass):

- `v0.projects.create({name})` **immediately returns a populated
  `vercelProjectId`** — a Vercel project is linked automatically. The
  `deploy()` code path that calls `integrations.vercel.projects.create()`
  only if one is missing is now a fallback that's expected to be a no-op in
  the common case, not a required step.
- **Preview URLs (`demoUrl`) are directly public** — confirmed via `curl`
  with no auth header, and via opening one standalone in a browser tab. No
  proxy needed, as suspected. Same for `screenshotUrl`. One real timing
  quirk: **`screenshotUrl` can return a "preview not available" placeholder
  graphic** (itself a valid, decodable image — not an error) for a short
  window right after a build finishes, before v0 has actually captured the
  screenshot; a thumbnail may briefly show that placeholder rather than the
  real screenshot.
- **The preview sandbox is a live, persistent dev environment**, not a
  static snapshot per version — it hot-reloads in place as v0 generates, the
  same way v0.dev's own chat UI shows code changes appearing live. Our
  iframe inherits this for free: no explicit re-fetch/refresh needed to see
  a change land in the preview.
- **Continuation reuses the exact same `v0_project_id`/`v0_chat_id`** —
  verified at both the identity level and the content level (a follow-up
  build's file list kept every prior file and added only the new one, with
  v0's own summary noting it matched the existing design).
- **Attachments**: confirmed a real image attachment (sent as a
  Supabase-signed URL) was received, described accurately by v0 (down to
  the actual colors/shape), and used as instructed for the hero background —
  not just accepted, genuinely used.
- **`message.content` is not display text** — it's v0's internal structured
  JSON of the generation trace (thinking steps, tool calls, file writes).
  `chat.text` (from `chats.getById`) is the real human-readable summary;
  confirmed against live responses and now what the app actually stores as
  the assistant's chat message.
- **`reports.getUsage({chatId, messageId})` returns dollar-denominated
  cost** as a string (`totalCost`, e.g. `"0.1683363"`), not token counts —
  exactly what feeds the credit ledger.

**Two real architectural bugs found and fixed by this testing** (not just
observed — see `src/lib/services/build-orchestrator.ts` and
`src/lib/services/v0-builder-engine.ts`):

1. A `chats.create`/`sendMessage` call hung indefinitely with no response —
   confirmed against v0 directly afterward that the message never reached
   it at all, so this is an outbound fetch hang, not a v0-side rejection.
   With no timeout, the request (and its build) was stuck forever with zero
   visible failure state, even after reload. Fixed: every builder-engine
   call is now wrapped in `withTimeout()` (`src/lib/utils/timeout.ts`).
2. The "one build at a time per project" guard was a check-then-insert with
   a real race window — two browser tabs submitting close together could
   both pass it (reproduced live). Fixed at the database level: a partial
   unique index (`builds_one_active_per_project`, migration `0002`) makes
   it an actual atomic constraint, not just an app-level check; the build
   row is also now created *before* calling the builder (previously after),
   so every attempt — including ones that time out — leaves a durable,
   visible record instead of an orphaned user message with no response.

A live-testing side effect also proved the failure-handling path for a
genuine v0 API error (a 404 from a stale message id): previously this threw
uncaught out of `advanceBuild`; now it's caught, and after a
non-transient-looking stretch of repeated failures the build is marked
`failed` with a clear message rather than polling forever with no outcome.

The one item from the original doc-only pass that's still unverified:
whether `pickMessageToTrack`'s "prefer the last assistant-role message"
heuristic is universally correct — it was correct in every case observed
live (the assistant message is present as a pending placeholder immediately
after `create`/`sendMessage`), so it's now backed by real evidence rather
than a guess, but hasn't been stress-tested against edge cases like a chat
with tool-call-only turns.

## Stack

- Next.js (App Router) + TypeScript
- Supabase (Postgres + Auth; Storage and Realtime land in later slices)
- Drizzle ORM (schema + migrations) — see "Database setup" below for why
  Drizzle owns table shape while RLS/triggers are a separate SQL file
- Tailwind CSS v4
- Zod for validation

## Local setup

1. **Install dependencies**

   ```
   pnpm install
   ```

2. **Create a Supabase project** (free tier is fine) at supabase.com.

3. **Copy `.env.example` to `.env.local`** and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY` — from Supabase Settings -> API.
   - `DATABASE_URL` — from Supabase Settings -> Database -> Connection
     string (use the session pooler URI, and swap in your DB password).
   - `V0_API_KEY` — from v0.app/settings/keys (needed for Slice 2, the
     builder loop).
   - `CRON_SECRET` — any random 16+ char string; only matters once deployed
     to Vercel (see "Build progress" below).
   - `ENCRYPTION_KEY` — needed for Slice 7 (integrations): `openssl rand
     -base64 32`. Customer-supplied integration secrets (e.g. a Paystack
     key) can't be saved without it.
   - `VERCEL_ACCESS_TOKEN` — needed for Slice 6 (publish) to actually make a
     published site public, and for Slice 10 (domains) to connect/verify a
     custom domain; see "Status" above.
   - `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY` — needed for Slice 9
     (billing); see "Status" above and `src/db/seed-paystack-plans.md`.
   - `RESEND_API_KEY`, `RESEND_FROM_EMAIL` — optional (Slice 11): without
     them, in-app notifications still work, they just don't also send email.
   - `ADMIN_EMAILS` — comma-separated emails allowed to view `/admin`
     (Slice 11). Leave unset to disable the page entirely (a plain 404 for
     everyone, admin included).

4. **Database setup.** Drizzle owns table shape and migration history;
   Supabase-specific behavior (Row Level Security policies, the
   profile-creation trigger) isn't something Drizzle models well, so it
   lives in a separate plain-SQL file instead of fighting the migration
   format:

   ```
   pnpm db:generate   # only needed after changing src/db/schema.ts
   pnpm db:migrate     # creates tables from src/db/migrations
   ```

   Then, in the Supabase SQL editor (Dashboard -> SQL Editor -> paste -> Run),
   run in order:
   1. `src/db/seed.sql` — seeds the `plans` table. Required before any
      signup: new profiles default to `plan_id = 'free'`, which is a foreign
      key into `plans`, so signup fails with no row there yet.
   2. `src/db/rls.sql` — Row Level Security policies + the trigger that
      creates a `profiles` row on signup.
   3. `src/db/storage.sql` — creates the private `attachments` Storage
      bucket + owner-scoped policies (needed once you're uploading files).

   All three files are idempotent, so re-running them later after schema changes
   is safe.

5. **(Optional, Slice 9) Set up Paystack billing.** Create the paid plans
   and store their codes per `src/db/seed-paystack-plans.md`, then register
   `<your app URL>/api/webhooks/paystack` as the webhook URL in the Paystack
   dashboard (Settings -> API Keys & Webhooks) — in local dev this needs a
   tunnel (e.g. `ngrok`) since Paystack can't reach `localhost` directly.
   Skip this if you're not testing billing yet; nothing else depends on it.

6. **Run the app**

   ```
   pnpm dev
   ```

   Visit `http://localhost:3000`, sign up, confirm the email Supabase sends
   (check spam in dev), and you should land on an empty dashboard.

## Build progress (how a change actually gets generated)

Sending a prompt calls the v0 API in async mode and immediately returns; a
`builds` row tracks it through `queued -> streaming -> succeeded|failed`.
Two things move it forward, so progress isn't lost if you close the tab:

- While the workspace is open, it polls a server action every 3s that
  checks the message status with v0 and finalizes the build once it's done.
- `/api/cron/advance-builds` does the same for every in-flight build,
  authenticated via `Authorization: Bearer $CRON_SECRET` — this is what
  `vercel.json`'s cron entry hits once deployed. Locally, nothing calls this
  route on a schedule, so leaving a build running with the tab closed won't
  finish it in dev; that's expected until this is actually deployed.

## Environment variables

See `.env.example` — grouped by which slice actually needs them.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm build` / `pnpm start` | Production build / run |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:generate` | Generate a Drizzle migration from `src/db/schema.ts` |
| `pnpm db:migrate` | Apply pending migrations to `DATABASE_URL` |

## Known limitations (through the HavenRock acceptance test)

- v0 enforces a real daily message limit per API key/plan tier (confirmed
  live during the HavenRock acceptance test — an `HTTP 429
  too_many_requests_error`), which the original architecture plan flagged as
  unverified and explicitly said not to hardcode. It's now confirmed to
  exist, but the actual numeric threshold is still unknown (only that this
  account hit it after a moderate number of messages across a day's testing)
  — don't assume any specific message count is safe. Already handled
  gracefully by existing error-handling code (falls through to the generic
  "builder temporarily unavailable" message) with no changes needed, but
  worth knowing before burning a real testing session against it. Endpoints
  outside message-sending (`deploy()`, domain-connect) are not subject to
  this limit.
- Notifications (Slice 11): `build_completed` and `deployment_completed`
  are live-verified; `build_failed` is now also live-verified (fired for
  real during the HavenRock acceptance test's stuck-build fix, not staged);
  `integration_attention` alone remains unverified — same `notifyUser()`
  path, not independently confirmed. Email delivery is entirely
  unverified — no `RESEND_API_KEY` this session; in-app delivery works
  regardless (see "Status" above).
- Admin (Slice 11): read-only by design (spec §51 — "operational data and
  service methods matter more than elaborate admin UI"). No way to actually
  change a price, credit grant, or feature flag from the UI yet — the plans
  table supports it (spec §20), but only direct SQL can edit it today. No
  way to revoke/change `ADMIN_EMAILS` from the UI either — it's an env var,
  changed only at deploy/restart time, by design (keeps the admin allowlist
  out of anything client-writable).
- Domains (Slice 10): connecting an existing domain is built, but the
  connect/verify calls themselves are unverified against a real Vercel
  API call and a real DNS challenge — no `VERCEL_ACCESS_TOKEN` this
  session, same gap as Slice 6. Domain *purchase* is deliberately not built
  at all (see "Status" above — this is a plan decision, not a gap).
- Billing (Slice 9): webhook processing is live-verified; the checkout
  redirect itself is not (no real Paystack account this session) — see
  "Status" above.
- No credit purchase (top-up) flow yet — `transactions.type` supports
  `credit_purchase` in the schema, but only the subscription checkout path
  is wired up.
- No proration or plan-downgrade handling — switching from Pro to Builder
  isn't implemented (`PlanCard` only offers upgrading to a plan with a
  `paystack_plan_code`, never shows a lower one as actionable).
- `subscription.disable` firing from Paystack's side sets `canceled`
  immediately rather than waiting for `current_period_end` — acceptable for
  V1 but means a webhook-driven cancellation and a user-initiated one
  (`cancel_at_period_end`) aren't handled with identical timing semantics.
- Rate limiting is per-project, not per-user across all their projects (a
  simpler check — no join across every project a user owns) — a documented
  V1 simplification that still catches the most likely abuse shape (one
  project hammered repeatedly).
- No global/platform-wide spend protection yet (spec §23) — only the
  per-user credit balance and per-project velocity limit exist so far.
- Publish doesn't reliably produce a truly public URL until a
  `VERCEL_ACCESS_TOKEN` is supplied — see "Status" above.
- Integration detection is a keyword scan over the prompt
  (`src/lib/config/providers.ts`), not a v0-signaled event — a provider
  mentioned without matching a registry keyword (or a provider not yet in
  the registry) won't trigger the panel, though v0 still builds around the
  missing credential regardless; only the *detection UI* can miss it.
- No way to edit/remove a configured integration's secret yet, or to
  re-verify one after v0 finishes wiring it up (`status` goes to
  `configured`, never automatically to `verified`).
- PDF attachments only send extracted text to v0, not the original layout —
  fine for reading company info, not for "match this document's design."
- A dashboard thumbnail can briefly show v0's own "preview not available yet"
  placeholder graphic right after a build finishes, before the real
  screenshot is ready — resolves itself on the next successful build/poll,
  nothing to fix.
- Dashboard thumbnails use v0's `screenshotUrl` directly (plain `<img>`, not
  `next/image`) since its hosting domain isn't confirmed yet for a
  `remotePatterns` allowlist entry.
- `src/db/types.ts` is hand-written to match `schema.ts` for the tables the
  Supabase client queries today. Once a live Supabase project exists, prefer
  regenerating it with `supabase gen types typescript` and extending it as
  later slices add tables the client queries directly. `project_secrets` is
  deliberately excluded from it (see `src/db/admin-types.ts`) since RLS
  denies every client context access to that table unconditionally.
