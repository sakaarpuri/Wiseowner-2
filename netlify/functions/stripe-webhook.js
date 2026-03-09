// Handles Stripe webhook events and updates Supabase billing records.
// Uses Node crypto for signature verification — no stripe npm needed.

const crypto = require('crypto');

function verifyStripeSignature(rawBody, header, secret) {
  const parts = header.split(',');
  const tPart = parts.find((p) => p.startsWith('t='));
  const v1Part = parts.find((p) => p.startsWith('v1='));
  if (!tPart || !v1Part) return false;

  const t = tPart.split('=')[1];
  const v1 = v1Part.split('=')[1];
  const signedPayload = `${t}.${rawBody}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expectedSig, 'hex'), Buffer.from(v1, 'hex'));
  } catch {
    return false;
  }
}

function billingBase() {
  return {
    user_id: null,
    email: null,
    stripe_customer_id: null,
    subscription_id: null,
    tier: 'free',
    status: 'inactive',
    period_end: null,
    credits_balance: 0,
    report_unlock_until: null,
    homeowner_reruns_remaining: 0,
  };
}

async function supabaseRest(path, init = {}) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase not configured');
  }

  const res = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase request failed: ${err}`);
  }

  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function getUserIdByEmail(email) {
  if (!email) return null;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;

  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data?.users?.[0]?.id || null;
}

async function getBillingAccount({ userId, email }) {
  if (userId) {
    const rows = await supabaseRest(`/rest/v1/billing_accounts?user_id=eq.${encodeURIComponent(userId)}&select=*`);
    if (rows?.[0]) return rows[0];
  }
  if (email) {
    const rows = await supabaseRest(`/rest/v1/billing_accounts?email=eq.${encodeURIComponent(email)}&select=*`);
    if (rows?.[0]) return rows[0];
  }
  return null;
}

async function upsertBillingAccount(data) {
  return supabaseRest('/rest/v1/billing_accounts', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(data),
  });
}

async function updateBillingForPurchase(payload) {
  const {
    userId,
    email,
    stripeCustomerId,
    subscriptionId,
    purchaseType,
    status = 'active',
    periodEnd = null,
    creditAmount = 0,
  } = payload;

  const existing = (await getBillingAccount({ userId, email })) || billingBase();
  const next = {
    ...existing,
    user_id: userId || existing.user_id,
    email: email || existing.email,
    stripe_customer_id: stripeCustomerId || existing.stripe_customer_id,
    subscription_id: subscriptionId || existing.subscription_id,
    status,
  };

  if (periodEnd) next.period_end = periodEnd;

  if (purchaseType === 'homeowner_report') {
    next.tier = 'homeowner_report';
    next.report_unlock_until = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    next.homeowner_reruns_remaining = 1;
  } else if (purchaseType === 'homeowner_yearly') {
    next.tier = 'homeowner_yearly';
    next.report_unlock_until = null;
    next.homeowner_reruns_remaining = 999999;
  } else if (purchaseType === 'realtor_credit_single' || purchaseType === 'realtor_credit_bundle') {
    next.tier = 'realtor_credit';
    next.credits_balance = Number(existing.credits_balance || 0) + Number(creditAmount || 0);
  } else if (purchaseType === 'realtor_unlimited') {
    next.tier = 'realtor_unlimited';
  }

  next.updated_at = new Date().toISOString();
  return upsertBillingAccount(next);
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return { statusCode: 500, body: 'Webhook secret not configured' };
  }

  const signature = event.headers['stripe-signature'];
  if (!signature) {
    return { statusCode: 400, body: 'Missing Stripe-Signature header' };
  }

  if (!verifyStripeSignature(event.body, signature, webhookSecret)) {
    console.error('Stripe signature verification failed');
    return { statusCode: 400, body: 'Invalid signature' };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  try {
    const { type, data } = stripeEvent;
    const obj = data.object;

    if (type === 'checkout.session.completed') {
      const email = obj.customer_details?.email || obj.customer_email || obj.metadata?.email || null;
      const customerId = obj.customer || null;
      const meta = obj.metadata || {};
      const purchaseType = meta.purchase_type;
      const creditAmount = Number(meta.credit_amount || 0);
      let userId = meta.supabase_user_id || null;

      if (!userId && email) {
        userId = await getUserIdByEmail(email);
      }

      if (purchaseType) {
        await updateBillingForPurchase({
          userId,
          email,
          stripeCustomerId: customerId,
          subscriptionId: obj.subscription || null,
          purchaseType,
          status: 'active',
          creditAmount,
        });
      }
    }

    if (type === 'customer.subscription.updated') {
      const meta = obj.metadata || {};
      const purchaseType = meta.purchase_type;
      const email = meta.email || null;
      const userId = meta.supabase_user_id || (email ? await getUserIdByEmail(email) : null);
      const normalizedStatus = ['active', 'trialing'].includes(obj.status) ? 'active' : obj.status;

      if (purchaseType) {
        await updateBillingForPurchase({
          userId,
          email,
          stripeCustomerId: obj.customer,
          subscriptionId: obj.id,
          purchaseType,
          status: normalizedStatus,
          periodEnd: obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null,
        });
      }
    }

    if (type === 'customer.subscription.deleted') {
      const meta = obj.metadata || {};
      const purchaseType = meta.purchase_type;
      const email = meta.email || null;
      const userId = meta.supabase_user_id || (email ? await getUserIdByEmail(email) : null);
      const existing = await getBillingAccount({ userId, email });
      if (existing && purchaseType) {
        await upsertBillingAccount({
          ...existing,
          user_id: userId || existing.user_id,
          email: email || existing.email,
          stripe_customer_id: obj.customer || existing.stripe_customer_id,
          subscription_id: obj.id,
          tier: purchaseType === 'realtor_unlimited' ? 'realtor_credit' : 'free',
          status: 'canceled',
          period_end: obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : existing.period_end,
          updated_at: new Date().toISOString(),
        });
      }
    }

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('stripe-webhook error:', err.message);
    return { statusCode: 500, body: err.message };
  }
};
