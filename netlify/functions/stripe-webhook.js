// Handles Stripe webhook events and updates Supabase subscriber records.
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

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expectedSig, 'hex'), Buffer.from(v1, 'hex'));
  } catch {
    return false;
  }
}

// Supabase REST upsert using service role key (bypasses RLS)
async function upsertSubscriber(data) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  const res = await fetch(`${supabaseUrl}/rest/v1/subscribers`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase upsert failed: ${err}`);
  }
}

// Look up user_id in Supabase by email (needed when user_id isn't in metadata)
async function getUserIdByEmail(email) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  const res = await fetch(
    `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    }
  );

  if (!res.ok) return null;
  const data = await res.json();
  return data?.users?.[0]?.id || null;
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
      const email = obj.customer_details?.email || obj.customer_email;
      const customerId = obj.customer;
      const meta = obj.metadata || {};
      let userId = meta.supabase_user_id;

      // Fall back to email lookup if user_id not in metadata
      if (!userId && email) {
        userId = await getUserIdByEmail(email);
      }

      if (!userId) {
        console.warn('checkout.session.completed: could not resolve user_id for', email);
        return { statusCode: 200, body: 'OK (no user matched)' };
      }

      if (obj.mode === 'subscription') {
        // Monthly plan
        await upsertSubscriber({
          user_id: userId,
          email,
          stripe_customer_id: customerId,
          stripe_subscription_id: obj.subscription,
          plan: 'monthly',
          status: 'active',
          updated_at: new Date().toISOString(),
        });
      } else if (obj.mode === 'payment') {
        // Lifetime plan (one-time payment)
        await upsertSubscriber({
          user_id: userId,
          email,
          stripe_customer_id: customerId,
          stripe_subscription_id: null,
          plan: 'lifetime',
          status: 'active',
          updated_at: new Date().toISOString(),
        });
      }
    }

    if (type === 'customer.subscription.updated') {
      const status = obj.status; // active, past_due, canceled, etc.
      const customerId = obj.customer;
      const userId = obj.metadata?.supabase_user_id;

      if (userId) {
        await upsertSubscriber({
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: obj.id,
          plan: 'monthly',
          status: ['active', 'trialing'].includes(status) ? 'active' : status,
          period_end: new Date(obj.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    if (type === 'customer.subscription.deleted') {
      const userId = obj.metadata?.supabase_user_id;
      if (userId) {
        await upsertSubscriber({
          user_id: userId,
          stripe_customer_id: obj.customer,
          stripe_subscription_id: obj.id,
          plan: 'monthly',
          status: 'canceled',
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
