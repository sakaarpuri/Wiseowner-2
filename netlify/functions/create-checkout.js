// Creates a Stripe Checkout session for monthly or yearly plans.
// Uses raw fetch — no stripe npm package needed.

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

// Stripe expects nested params as: customer[metadata][foo]=bar
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
    } else {
      flat[key] = v;
    }
  }
  return flat;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const monthlyPriceId = process.env.STRIPE_MONTHLY_PRICE_ID;
  const yearlyPriceId = process.env.STRIPE_YEARLY_PRICE_ID;

  if (!stripeKey || !monthlyPriceId || !yearlyPriceId) {
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

  const { email, userId, plan, origin } = body;
  if (!email || !userId || !['monthly', 'yearly'].includes(plan)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'email, userId, and plan required' }) };
  }

  const baseUrl = origin || 'https://boisterous-brioche-7a63c3.netlify.app';
  const successUrl = `${baseUrl}/?payment=success`;
  const cancelUrl = `${baseUrl}/?payment=cancelled`;

  try {
    // Find or create Stripe customer
    const search = await stripeApi(`customers/search?query=email:'${encodeURIComponent(email)}'`);
    let customer;
    if (search.data && search.data.length > 0) {
      customer = search.data[0];
    } else {
      customer = await stripeApi('customers', 'POST', {
        email,
        metadata: { supabase_user_id: userId },
      });
    }

    // Build session params based on plan
    const sessionParams = {
      customer: customer.id,
      success_url: successUrl,
      cancel_url: cancelUrl,
      mode: 'subscription',
      line_items: [
        {
          price: plan === 'yearly' ? yearlyPriceId : monthlyPriceId,
          quantity: 1,
        },
      ],
      metadata: {
        supabase_user_id: userId,
        plan,
      },
      allow_promotion_codes: 'true',
    };

    sessionParams.subscription_data = {
      metadata: { supabase_user_id: userId, plan },
    };

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
