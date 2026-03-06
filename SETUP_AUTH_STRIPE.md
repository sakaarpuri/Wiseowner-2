# Auth + Subscription Setup Guide

Follow these steps **once** before deploying. Takes ~20 minutes.

---

## 1. Supabase Project

1. Go to https://supabase.com → New project
2. Note your **Project URL** and **anon (public) key** (Settings → API)
3. Also copy the **service_role** key (keep secret — server only)

### Run this SQL in the Supabase SQL Editor:

```sql
-- Subscriber table
CREATE TABLE subscribers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT,
  plan TEXT DEFAULT 'free',        -- 'free' | 'monthly' | 'lifetime'
  status TEXT DEFAULT 'active',    -- 'active' | 'canceled' | 'past_due'
  period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Row-level security (users can only read their own row)
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own subscriber data"
  ON subscribers FOR SELECT
  USING (auth.uid() = user_id);

-- Service role bypasses RLS automatically (used by webhook function)
```

### Supabase Auth settings:
- Authentication → Settings → Site URL: `https://boisterous-brioche-7a63c3.netlify.app`
- Add same URL to Redirect URLs

---

## 2. Stripe Products

1. Go to https://dashboard.stripe.com → Products → Add product

**Product 1 — Monthly**
- Name: `Keep or Sell Pro`
- Price: `$7.00 / month` (recurring)
- Copy the **Price ID** (starts with `price_...`)

**Product 2 — Lifetime**
- Name: `Keep or Sell Lifetime`
- Price: `$49.00` (one-time)
- Copy the **Price ID**

### Stripe Webhook:
1. Developers → Webhooks → Add endpoint
2. URL: `https://boisterous-brioche-7a63c3.netlify.app/.netlify/functions/stripe-webhook`
3. Events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the **Webhook signing secret** (starts with `whsec_...`)

---

## 3. Netlify Environment Variables

Add all of these in **Netlify → Site settings → Environment variables**:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_KEY` | Supabase service_role key (**secret**) |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_live_...`) |
| `STRIPE_PUBLIC_KEY` | Stripe publishable key (`pk_live_...`) |
| `STRIPE_MONTHLY_PRICE_ID` | Monthly price ID (`price_...`) |
| `STRIPE_LIFETIME_PRICE_ID` | Lifetime price ID (`price_...`) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (`whsec_...`) |

> ⚠️ Use `sk_test_` / `pk_test_` keys while testing, switch to live keys when ready to charge.

---

## 4. Test Checklist

- [ ] Click "Sign in" → modal appears
- [ ] Create a test account → confirmation email arrives
- [ ] Sign in → header shows email chip
- [ ] Run analysis → AI box and tax breakdown show locked overlays
- [ ] Click a plan → redirects to Stripe checkout
- [ ] Complete test payment (use card `4242 4242 4242 4242`) → redirected back
- [ ] After redirect, AI + tax unlock within ~3 seconds
- [ ] Sign out → header resets

---

## 5. Stripe Customer Portal (optional — for self-serve cancellations)

When ready, add a `create-portal.js` serverless function that calls:
`POST https://api.stripe.com/v1/billing_portal/sessions`

This lets users manage/cancel their own subscription without contacting you.
