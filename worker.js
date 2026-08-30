const USDTONPAY_ENDPOINT = 'https://usdtonpay.com/api/v1/payments';
const DEBUG_USDTONPAY = true;

const CATALOG = Object.freeze({
  sienna: 0.50,
  luna: 0.50,
  aria: 0.50,
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

function safeText(text) {
  if (!text) return '';
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .slice(0, 4000);
}

function validateHostedCheckoutUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value, 'https://usdtonpay.com');
    const host = url.hostname.toLowerCase();
    const allowed = host === 'usdtonpay.com' || host.endsWith('.usdtonpay.com');
    if (url.protocol !== 'https:' || !allowed) return null;
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
    return json({
      ok: false,
      error: 'Payment service is not configured.',
      debug: { key_configured: false }
    }, 503);
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
  } catch {
    return json({ ok: false, error: 'Invalid cart.' }, 400);
  }

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
        'authorization': `Bearer ${apiKey}`,
        'accept': 'application/json',
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch (err) {
    console.error('[FactoryDrops] USDTonPay network error', err);
    return json({
      ok: false,
      error: 'USDTonPay network request failed.',
      debug: {
        stage: 'network',
        endpoint: USDTONPAY_ENDPOINT,
        request_body: upstreamBody,
        message: String(err?.message || err),
      }
    }, 502);
  }

  const raw = await upstream.text();

  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {}

  console.log('[FactoryDrops] USDTonPay response', JSON.stringify({
    upstream_status: upstream.status,
    request_body: upstreamBody,
    upstream_body: safeText(raw),
  }));

  if (!upstream.ok) {
    return json({
      ok: false,
      error: 'USDTonPay rejected the payment request.',
      debug: {
        upstream_status: upstream.status,
        endpoint: USDTONPAY_ENDPOINT,
        request_body: upstreamBody,
        upstream_body: safeText(raw),
      }
    }, 502);
  }

  const paymentId =
    data?.payment_id ??
    data?.id ??
    data?.payment?.payment_id ??
    data?.payment?.id ??
    null;

  const rawCheckoutUrl =
    data?.payment_url ??
    data?.checkout_url ??
    data?.hosted_checkout_url ??
    data?.url ??
    data?.payment?.payment_url ??
    data?.payment?.checkout_url ??
    null;

  const paymentUrl = validateHostedCheckoutUrl(rawCheckoutUrl);

  if (!paymentId || !paymentUrl) {
    return json({
      ok: false,
      error: 'USDTonPay returned success but checkout fields were not recognized.',
      debug: {
        upstream_status: upstream.status,
        endpoint: USDTONPAY_ENDPOINT,
        request_body: upstreamBody,
        upstream_body: safeText(raw),
      }
    }, 502);
  }

  return json({
    ok: true,
    order_id: orderId,
    amount,
    status: 'payment_pending',
    payment_id: String(paymentId),
    payment_amount: data?.payment_amount ?? data?.amount ?? null,
    payment_url: paymentUrl,
    debug: {
      upstream_status: upstream.status,
      endpoint: USDTONPAY_ENDPOINT,
      request_body: upstreamBody,
      upstream_body: safeText(raw),
    }
  });
}

function pickWebhookSummary(data) {
  if (!data || typeof data !== 'object') return null;

  return {
    event: data.event ?? data.type ?? data.event_type ?? null,
    payment_id:
      data.payment_id ??
      data.id ??
      data.payment?.payment_id ??
      data.payment?.id ??
      null,
    order_id:
      data.order_id ??
      data.merchant_order_id ??
      data.payment?.order_id ??
      data.payment?.merchant_order_id ??
      null,
    status:
      data.status ??
      data.payment_status ??
      data.payment?.status ??
      null,
    amount:
      data.amount ??
      data.payment_amount ??
      data.payment?.amount ??
      data.payment?.payment_amount ??
      null,
    tx_hash:
      data.tx_hash ??
      data.transaction_hash ??
      data.payment?.tx_hash ??
      data.payment?.transaction_hash ??
      null,
  };
}

async function handleUsdtonpayWebhook(request) {
  if (request.method === 'GET') {
    return json({
      ok: true,
      endpoint: '/api/webhooks/usdtonpay',
      mode: 'webhook-test-v1',
      message: 'Endpoint is online. Send a POST webhook to test delivery.'
    }, 200);
  }

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed.' }, 405);
  }

  const signature =
    request.headers.get('x-usdtonpay-signature') ??
    request.headers.get('X-USDTonPay-Signature');

  const contentType = request.headers.get('content-type') || '';
  const userAgent = request.headers.get('user-agent') || '';

  let raw = '';
  try {
    raw = await request.text();
  } catch (err) {
    console.error('[FactoryDrops][Webhook] Failed to read body:', err);
    return json({ ok: false, error: 'Unable to read webhook body.' }, 400);
  }

  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {}

  const summary = pickWebhookSummary(parsed);

  console.log('[FactoryDrops][Webhook] USDTonPay webhook received:', JSON.stringify({
    received_at: new Date().toISOString(),
    signature_present: Boolean(signature),
    signature_preview: signature ? `${signature.slice(0, 12)}...` : null,
    content_type: contentType,
    user_agent: userAgent,
    summary,
    raw_body: safeText(raw),
  }));

  return json({
    ok: true,
    received: true,
    mode: 'webhook-test-v1',
    signature_present: Boolean(signature),
    summary,
  }, 200);
}

const GOOGLE_TAG_HTML = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-PKF23BXWYY"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-PKF23BXWYY');
</script>`;

function injectGoogleTag(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');

  const uncachedResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });

  return new HTMLRewriter()
    .on('head', {
      element(element) {
        element.prepend(GOOGLE_TAG_HTML, { html: true });
      }
    })
    .transform(uncachedResponse);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/webhooks/usdtonpay') {
      return handleUsdtonpayWebhook(request);
    }

    if (url.pathname === '/api/demo-shop/create-payment') {
      return createPayment(request, env);
    }

    if (url.pathname === '/api/demo-shop/debug-config') {
      return json({
        ok: true,
        usdtonpay_key_configured: Boolean(env.USDTONPAY_API_KEY),
        endpoint: USDTONPAY_ENDPOINT,
        debug: DEBUG_USDTONPAY,
      });
    }

    const assetResponse = await env.ASSETS.fetch(request);
    return injectGoogleTag(assetResponse);
  },
};
