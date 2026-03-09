// Creates a Stripe Checkout session for homeowner and realtor purchases.
// Uses raw fetch — no stripe npm package needed.

const PRICE_ENV_BY_PURCHASE = {
  homeowner_report: 'STRIPE_PRICE_HOMEOWNER_REPORT',
  homeowner_yearly: 'STRIPE_PRICE_HOMEOWNER_YEARLY',
  realtor_credit_single: 'STRIPE_PRICE_REALTOR_CREDIT_SINGLE',
  realtor_credit_bundle: 'STRIPE_PRICE_REALTOR_CREDIT_BUNDLE',
  realtor_unlimited: 'STRIPE_PRICE_REALTOR_UNLIMITED',
};

const PURCHASE_CONFIG = {
  homeowner_report: { mode: 'payment', accountType: 'homeowner', creditAmount: 0 },
  homeowner_yearly: { mode: 'subscription', accountType: 'homeowner', creditAmount: 0 },
  realtor_credit_single: { mode: 'payment', accountType: 'realtor', creditAmount: 1, requiresUser: true },
  realtor_credit_bundle: { mode: 'payment', accountType: 'realtor', creditAmount: 10, requiresUser: true },
  realtor_unlimited: { mode: 'subscription', accountType: 'realtor', creditAmount: 0, requiresUser: true },
};

const stripeApi = async (endpoint, method = 'GET', params = null) => {
  const res = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params ? new URLSearchParams(flattenParams(params)).toString() : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Stripe error');
  return data;
};

function flattenParams(obj, prefix = '') {
  const flat = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(flat, flattenParams(v, key));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === 'object') {
          Object.assign(flat, flattenParams(item, `${key}[${i}]`));
        } else {
          flat[`${key}[${i}]`] = item;
        }
      });
    } else if (v !== undefined && v !== null) {
      flat[key] = v;
    }
  }
  return flat;
}

async function findOrCreateCustomer(email, userId, accountType) {
  const search = await stripeApi(`customers/search?query=email:'${encodeURIComponent(email)}'`);
  if (search.data && search.data.length > 0) {
    return search.data[0];
  }
  return stripeApi('customers', 'POST', {
    email,
    metadata: {
      supabase_user_id: userId || '',
      account_type: accountType || '',
    },
  });
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Stripe not fully configured' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { email, userId, purchaseType, origin, reportId } = body;
  const config = PURCHASE_CONFIG[purchaseType];
  if (!email || !config) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'email and purchaseType are required' }),
    };
  }
  if (config.requiresUser && !userId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'This purchase requires a signed-in account' }),
    };
  }

  const priceEnvName = PRICE_ENV_BY_PURCHASE[purchaseType];
  const priceId = process.env[priceEnvName];
  if (!priceId) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Missing ${priceEnvName}` }),
    };
  }

  const baseUrl = origin || 'https://www.zamindaro.com';
  const successUrl = `${baseUrl}/?payment=success&purchase_type=${encodeURIComponent(purchaseType)}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${baseUrl}/?payment=cancelled&purchase_type=${encodeURIComponent(purchaseType)}`;

  try {
    const customer = await findOrCreateCustomer(email, userId, config.accountType);
    const metadata = {
      supabase_user_id: userId || '',
      purchase_type: purchaseType,
      account_type: config.accountType,
      email,
      credit_amount: String(config.creditAmount || 0),
      report_id: reportId || '',
    };

    const sessionParams = {
      customer: customer.id,
      success_url: successUrl,
      cancel_url: cancelUrl,
      mode: config.mode,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata,
      allow_promotion_codes: 'true',
      customer_update: { address: 'auto', name: 'auto' },
    };

    if (config.mode === 'subscription') {
      sessionParams.subscription_data = {
        metadata,
      };
    }

    const session = await stripeApi('checkout/sessions', 'POST', sessionParams);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('create-checkout error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
