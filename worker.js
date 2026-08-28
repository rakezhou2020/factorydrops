const USDTONPAY_ENDPOINT = 'https://usdtonpay.com/api/v1/payments';

// Demo Shop prices are authoritative on the server.
// The browser never decides the amount sent to USDTonPay.
const CATALOG = Object.freeze({
  sienna: 29.99,
  luna: 34.99,
  aria: 39.99,
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function validOrderId(value) {
  return typeof value === 'string' && /^FD-DEMO-[A-Z0-9-]{10,64}$/.test(value);
}

function calculateAmount(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
    throw new Error('INVALID_CART');
  }

  let cents = 0;
  for (const item of items) {
    const price = CATALOG[item?.id];
    const qty = Number(item?.qty);

    if (price == null || !Number.isInteger(qty) || qty < 1 || qty > 20) {
      throw new Error('INVALID_CART');
    }

    cents += Math.round(price * 100) * qty;
  }

  if (cents < 1 || cents > 10_000_000) {
    throw new Error('INVALID_AMOUNT');
  }

  return (cents / 100).toFixed(2);
}

function safeUpstreamLog(text) {
  if (!text) return '';
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .slice(0, 1800);
}

function validateHostedCheckoutUrl(value) {
  if (typeof value !== 'string' || !value) return null;

  try {
    const url = new URL(value, 'https://usdtonpay.com');
    const host = url.hostname.toLowerCase();
    const allowedHost = host === 'usdtonpay.com' || host.endsWith('.usdtonpay.com');

    if (url.protocol !== 'https:' || !allowedHost) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function createPayment(request, env) {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed.' }, 405);
  }

  const apiKey = env.USDTONPAY_API_KEY;
  if (!apiKey) {
    console.error('[FactoryDrops] USDTONPAY_API_KEY is not configured.');
    return json({ ok: false, error: 'Payment service is not configured.' }, 503);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }

  const orderId = input?.order_id;
  if (!validOrderId(orderId)) {
    return json({ ok: false, error: 'Invalid order.' }, 400);
  }

  let amount;
  try {
    amount = calculateAmount(input?.items);
  } catch (err) {
    console.warn('[FactoryDrops] Rejected demo order:', orderId, err?.message || err);
    return json({ ok: false, error: 'Invalid cart.' }, 400);
  }

  // Round 1: local demo order state is payment_pending.
  // Durable database persistence is intentionally not added yet.
  const localOrder = {
    order_id: orderId,
    amount,
    status: 'payment_pending',
    created_at: new Date().toISOString(),
  };
  console.info('[FactoryDrops] Demo order created:', JSON.stringify(localOrder));

  // Current USDTonPay create-payment contract used by this integration.
  const upstreamBody = {
    order_id: orderId,
    amount,
    currency: 'USDT',
  };

  let upstream;
  try {
    upstream = await fetch(USDTONPAY_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch (err) {
    console.error('[FactoryDrops] USDTonPay network error:', err?.stack || err);
    return json({ ok: false, error: 'Could not create payment. Please try again.' }, 502);
  }

  const raw = await upstream.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!upstream.ok) {
    console.error(
      '[FactoryDrops] USDTonPay create-payment failed:',
      JSON.stringify({
        status: upstream.status,
        order_id: orderId,
        response: safeUpstreamLog(raw),
      }),
    );
    return json({ ok: false, error: 'Could not create payment. Please try again.' }, 502);
  }

  const paymentId = data?.payment_id;
  const paymentUrl = validateHostedCheckoutUrl(data?.payment_url);

  if (typeof paymentId !== 'string' || !paymentId || !paymentUrl) {
    console.error(
      '[FactoryDrops] USDTonPay success response missing required fields:',
      JSON.stringify({
        status: upstream.status,
        order_id: orderId,
        response: safeUpstreamLog(raw),
      }),
    );
    return json({ ok: false, error: 'Payment service returned an invalid response.' }, 502);
  }

  console.info(
    '[FactoryDrops] USDTonPay payment created:',
    JSON.stringify({
      order_id: orderId,
      payment_id: paymentId,
      payment_amount: data?.payment_amount ?? null,
      status: 'payment_pending',
    }),
  );

  // Only non-sensitive fields required by the browser are returned.
  return json({
    ok: true,
    order_id: orderId,
    amount,
    status: 'payment_pending',
    payment_id: paymentId,
    payment_amount: data?.payment_amount ?? null,
    payment_url: paymentUrl,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/demo-shop/create-payment') {
      return createPayment(request, env);
    }

    // Everything else stays exactly like the existing static FactoryDrops site.
    return env.ASSETS.fetch(request);
  },
};
