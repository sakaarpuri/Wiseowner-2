# zamindaro

A US homeowner property decision tool that helps people decide whether to **keep or sell** a property, with renting treated as one keep path. It includes free estimates, homeowner report unlocks, and realtor-specific credit or unlimited plans.

**Stack:** Single HTML file · Vanilla JS/CSS · Netlify serverless functions · Chart.js · Anthropic AI · Supabase · Stripe

---

## Quick Start (Local Dev)

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Netlify CLI](https://docs.netlify.com/cli/get-started/) — `npm install -g netlify-cli`

### 1. Clone and open the project

```bash
git clone <your-repo-url> keeporsell-us
cd keeporsell-us
```

### 2. Add environment variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Then fill in your keys (see [Environment Variables](#environment-variables) below).

### 3. Run locally

```bash
netlify dev
```

Visit **http://localhost:8888** in your browser.

> The Netlify CLI handles routing to your serverless functions automatically. No separate backend needed.

---

## Environment Variables

Add these to your `.env` file for local dev, and to **Netlify → Site Settings → Environment Variables** for production.

| Variable | Required | Where to get it | Cost |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ Yes | [console.anthropic.com](https://console.anthropic.com) → API Keys | Pay per use (~$0.01/analysis) |
| `GOOGLE_MAPS_API_KEY` | Optional | Google Cloud Console (see below) | Free tier — generous limits |
| `RENTCAST_KEY` | Optional | [Rentcast.io](https://rentcast.io) → API Keys (see below) | ~$45/mo (Starter) |
| `PROPSTREAM_KEY` | Optional (Phase 3) | PropStream — contact sales | ~$99/mo |

**Without optional keys:** The app still works fully. Address autocomplete and AVM pre-fill are disabled; the motivated seller directory shows realistic mock data.

---

## API Setup Guides

### Anthropic API (Claude AI)

Used for the plain-English analysis of each homeowner's situation.

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up or log in
3. Navigate to **API Keys** → **Create Key**
4. Copy the key → add to `.env` as `ANTHROPIC_API_KEY`

> Model used: `claude-sonnet-4-20250514`. Cost is approximately $0.003 per 1K input tokens and $0.015 per 1K output tokens — roughly $0.01 per analysis.

---

### Google Places API (Address Autocomplete + Geocoding)

Used for the address autocomplete field in Step 1 and to resolve state/county/zip from an address.

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Navigate to **APIs & Services → Library**
4. Enable both:
   - **Places API**
   - **Geocoding API**
5. Go to **APIs & Services → Credentials → Create Credentials → API Key**
6. Copy the key
7. **Restrict the key** (recommended):
   - Under **Application restrictions** → select **HTTP referrers**
   - Add your domain: `https://yourdomain.com/*` and `http://localhost:8888/*`
   - Under **API restrictions** → select **Restrict key** → check Places API + Geocoding API
8. Add to `.env` as `GOOGLE_MAPS_API_KEY`

> **Free tier:** Google gives $200/month in free credits, which covers ~40,000 autocomplete requests or ~100,000 geocode calls. More than enough for most use cases.

---

### Rentcast API (AVM + Sale History)

Used to auto-fill estimated property value, last sale price, year built, and property type when an address is selected.

1. Go to [app.rentcast.io](https://app.rentcast.io) and create an account
2. Navigate to **API → API Keys → Create Key**
3. Copy the key → add to `.env` as `RENTCAST_KEY`
4. Choose a plan: **Free** (50 calls/mo, good for dev) or **Starter** (~$45/mo for production)

> Rentcast is called directly — no RapidAPI middleman. The function hits `api.rentcast.io/v1/properties` for property details and `api.rentcast.io/v1/avm/value` for the estimated value. Auth uses the `X-Api-Key` header.

> If no key is set, the address autocomplete still works (populates state only), but the value/purchase price fields won't auto-fill. The user can enter them manually.

---

### PropStream (Motivated Seller Directory — Phase 3)

Used to search for motivated sellers by zip code, filter by equity and seller signals, and retrieve owner/mailing info.

1. Go to [PropStream.com](https://propstream.com) and sign up for an account
2. Contact their sales team to request **API access** (not all plans include it by default)
3. Once approved, retrieve your API bearer token from the PropStream dashboard
4. Add to `.env` as `PROPSTREAM_KEY`

> **Without this key:** The directory still works using 8 realistic mock properties (Austin, TX). This is intentional — the MVP is fully functional without PropStream. Add the key when you're ready to go live.

> **Alternative:** [BatchLeads](https://batchleads.io/api) is a similar service with API access. You'd need to update the request format in `netlify/functions/directory.js` to match their endpoints.

---

## Netlify Deployment

### Option A — Drag & Drop (fastest)

1. Go to [netlify.com/drop](https://app.netlify.com/drop)
2. Drag your entire project folder onto the page
3. Netlify detects `netlify.toml` and configures functions automatically
4. Once deployed, go to **Site Settings → Environment Variables**
5. Add each key from the table above
6. Trigger a redeploy: **Deploys → Trigger deploy → Deploy site**

### Option B — Git + Continuous Deploy

1. Push your code to a GitHub/GitLab repo
2. In Netlify dashboard → **Add new site → Import an existing project**
3. Connect your repo, set branch to `main`
4. Build settings are auto-detected from `netlify.toml` (no build command needed)
5. Add environment variables under **Site Settings → Environment Variables**
6. Every push to `main` auto-deploys

### Custom Domain

Go to **Domain Management → Add custom domain** in your Netlify site settings. SSL is provisioned automatically.

---

## Project Structure

```
keeporsell-us/
├── index.html                    ← Main single-file app (all UI, JS, CSS)
├── netlify.toml                  ← Netlify routing + function config
├── README.md                     ← This file
├── data/
│   └── state-tax-rates.json      ← Capital gains rates for all 50 states + DC
└── netlify/functions/
    ├── analyze.js                ← Claude AI interpretation (Anthropic API)
    ├── geocode.js                ← Address → state/county/zip (Google Geocoding API)
    ├── property-data.js            ← AVM + sale history (Rentcast API)
    └── directory.js              ← Motivated seller search (PropStream, with mock fallback)
```

---

## Tax Engine Reference

The calculator implements US federal and state capital gains rules:

| Rule | Implementation |
|---|---|
| **§121 Exclusion** | $250K (single) / $500K (married) if 2-of-5-year primary residence requirement met |
| **Federal LTCG rate** | 0% / 15% / 20% based on taxable income + filing status (2024 brackets) |
| **NIIT** | 3.8% on gains for income above $200K (single) / $250K (married) |
| **Depreciation recapture** | 25% on estimated prior depreciation (building value ÷ 27.5 × rental years) |
| **State tax** | Looked up from `data/state-tax-rates.json`. WA has a $262K threshold. |

---

## Phase 3 Note — Motivated Seller Directory

The directory (`netlify/functions/directory.js`) is production-ready with mock data and PropStream integration. It works out of the box without any API key — mock data is returned for development and demos.

To go live:
1. Add `PROPSTREAM_KEY` to your environment variables
2. The function automatically switches from mock to live PropStream data
3. If PropStream returns an error, it silently falls back to mock data

Results 6+ are blurred behind a paywall overlay. The "Start free trial" CTA shows a coming-soon modal — wire it to your payment/auth provider when ready.

---

## Cost Summary

| Service | Dev cost | Production cost |
|---|---|---|
| Anthropic API | Pay per use | ~$0.01 per analysis |
| Google Places | Free | Free (generous $200/mo credit) |
| Rentcast | Free (50 calls/mo) | ~$45/mo (Starter) |
| PropStream | N/A (mock in dev) | ~$99/mo (Phase 3 only) |
| Netlify | Free | Free (functions included on all plans) |

**Minimum to run the full app in production (without directory):** ~$45–55/mo

---

## Local `.env.example`

```
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Optional — address autocomplete + geocoding
GOOGLE_MAPS_API_KEY=AIza...

# Optional — AVM + sale history pre-fill (Rentcast)
RENTCAST_KEY=

# Optional — Phase 3 motivated seller directory
PROPSTREAM_KEY=your-propstream-token

# Auth / database
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_PUBLIC_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_HOMEOWNER_REPORT=
STRIPE_PRICE_HOMEOWNER_YEARLY=
STRIPE_PRICE_REALTOR_CREDIT_SINGLE=
STRIPE_PRICE_REALTOR_CREDIT_BUNDLE=
STRIPE_PRICE_REALTOR_UNLIMITED=
```
