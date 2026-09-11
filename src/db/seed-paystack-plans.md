# Paystack plan setup (one-time, manual)

`plans.paystack_plan_code` links our `builder`/`pro` plans to a plan
provisioned on Paystack's side — plans aren't created dynamically at
runtime, only referenced by code. Do this once per Paystack account
(test mode and live mode each need their own).

The `free` plan needs no Paystack plan — there's nothing to subscribe to.

## 1. Create the plans on Paystack

Via the dashboard: Settings -> Plans -> New Plan, or via the API:

```bash
curl https://api.paystack.co/plan \
  -H "Authorization: Bearer $PAYSTACK_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Builder", "amount": 1900, "interval": "monthly"}'

curl https://api.paystack.co/plan \
  -H "Authorization: Bearer $PAYSTACK_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Pro", "amount": 4900, "interval": "monthly"}'
```

`amount` is in the smallest currency unit (kobo for NGN — adjust if billing
in a different currency; `price_cents` in our own `plans` table should
match whatever `amount` actually is here, in cents/kobo). Each response's
`data.plan_code` (e.g. `PLN_xxxxxxxx`) is what goes in step 2.

## 2. Store the plan codes in our own `plans` table

```sql
update public.plans set paystack_plan_code = 'PLN_xxxxxxxx' where id = 'builder';
update public.plans set paystack_plan_code = 'PLN_xxxxxxxx' where id = 'pro';
```

Until this is done, `startCheckout()` rejects with "This plan isn't
available for checkout yet" rather than silently failing partway through a
real payment flow.
