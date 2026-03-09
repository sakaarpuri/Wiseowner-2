# zamindaro Auth + Pricing V2 Setup

Apply this once before turning on live billing and realtor accounts.

## 1. Supabase project

Use a dedicated Supabase project for `zamindaro`, preferably in a US region.

Required project settings:
- `Authentication -> URL Configuration`
  - `Site URL`: `https://www.zamindaro.com`
  - Redirect URLs:
    - `https://www.zamindaro.com/**`
    - `https://zamindaro.com/**`
    - `http://localhost:8000/**`

## 2. Supabase schema

Run this in the SQL editor.

```sql
create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid default gen_random_uuid() primary key,
  user_id uuid unique references auth.users(id) on delete cascade,
  account_type text not null default 'homeowner' check (account_type in ('homeowner', 'realtor')),
  full_name text,
  brokerage_name text,
  phone text,
  photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists billing_accounts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid unique references auth.users(id) on delete cascade,
  email text unique,
  stripe_customer_id text unique,
  subscription_id text,
  tier text not null default 'free',
  status text not null default 'inactive',
  period_end timestamptz,
  credits_balance integer not null default 0,
  report_unlock_until timestamptz,
  homeowner_reruns_remaining integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reports (
  id uuid default gen_random_uuid() primary key,
  owner_user_id uuid references auth.users(id) on delete set null,
  account_type text not null default 'homeowner' check (account_type in ('homeowner', 'realtor')),
  address text,
  state text,
  winner_key text,
  keep_mode text,
  match_score integer,
  inputs_json jsonb not null default '{}'::jsonb,
  outputs_json jsonb not null default '{}'::jsonb,
  pdf_url text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table billing_accounts enable row level security;
alter table reports enable row level security;

create policy "profiles read own"
  on profiles for select
  using (auth.uid() = user_id);

create policy "profiles update own"
  on profiles for update
  using (auth.uid() = user_id);

create policy "profiles insert own"
  on profiles for insert
  with check (auth.uid() = user_id);

create policy "billing read own"
  on billing_accounts for select
  using (auth.uid() = user_id);

create policy "billing update own"
  on billing_accounts for update
  using (auth.uid() = user_id);

create policy "reports read own"
  on reports for select
  using (auth.uid() = owner_user_id);

create policy "reports insert own"
  on reports for insert
  with check (auth.uid() = owner_user_id);

create policy "reports update own"
  on reports for update
  using (auth.uid() = owner_user_id);
```

### Storage

Create a public bucket:
- `realtor-assets`

Use it for:
- realtor profile photos
- saved PDF assets if you later persist PDFs server-side

## 3. Stripe catalog

Create these Stripe prices and keep the resulting `price_...` IDs.

### Homeowner
- `Homeowner Report`
  - one-time
  - `$9`
- `Homeowner Yearly`
  - recurring yearly
  - `$49 / year`

### Realtor
- `Realtor Single Credit`
  - one-time
  - `$6`
- `Realtor Credit Bundle`
  - one-time
  - `$55`
- `Realtor Unlimited`
  - recurring monthly
  - `$39 / month`

## 4. Stripe webhook

Create one webhook endpoint:

- test/staging:
  - `https://boisterous-brioche-7a63c3.netlify.app/.netlify/functions/stripe-webhook`
- production:
  - `https://www.zamindaro.com/.netlify/functions/stripe-webhook`

Listen for:
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Copy the webhook signing secret:
- `whsec_...`

## 5. Netlify environment variables

Set these in Netlify:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | public anon key |
| `SUPABASE_SERVICE_KEY` | service role key |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_PUBLIC_KEY` | Stripe publishable key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_HOMEOWNER_REPORT` | one-time $9 report price |
| `STRIPE_PRICE_HOMEOWNER_YEARLY` | recurring $49/year homeowner price |
| `STRIPE_PRICE_REALTOR_CREDIT_SINGLE` | one-time $6 single-credit price |
| `STRIPE_PRICE_REALTOR_CREDIT_BUNDLE` | one-time $55 bundle price |
| `STRIPE_PRICE_REALTOR_UNLIMITED` | recurring $39/month realtor price |
| `GOOGLE_MAPS_API_KEY` | Google Maps Places key |
| `ANTHROPIC_API_KEY` | AI interpretation |
| `RENTCAST_KEY` | property data lookup |
| `PROPSTREAM_KEY` | optional directory data |

## 6. Frontend purchase identifiers

The app now uses these exact purchase identifiers end to end:

- `homeowner_report`
- `homeowner_yearly`
- `realtor_credit_single`
- `realtor_credit_bundle`
- `realtor_unlimited`

Do not reuse the old `monthly | yearly` identifiers.

## 7. Expected behavior

### Homeowner
- free estimate works without account
- `$9 report` unlocks:
  - interpretation
  - full tax breakdown
  - PDF export
  - one rerun within 30 days
- `$49 yearly` keeps premium homeowner access active while the subscription is active

### Realtor
- realtor account stores profile metadata
- single credit adds 1 credit
- bundle adds 10 credits
- unlimited subscription removes per-report gating
- dashboard reads from `reports`

## 8. Test checklist

- [ ] Sign up as homeowner
- [ ] Sign up as realtor and save profile
- [ ] Pricing page shows the two-column final structure
- [ ] Homeowner `$9 report` opens Stripe checkout
- [ ] Homeowner `$49 yearly` opens recurring Stripe checkout
- [ ] Realtor single credit / bundle / unlimited options open the correct checkout mode
- [ ] Webhook updates `billing_accounts`
- [ ] Realtor dashboard loads once schema is applied
