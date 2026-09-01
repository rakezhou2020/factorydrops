const USDTONPAY_ENDPOINT = 'https://usdtonpay.com/api/v1/payments';
const DEBUG_USDTONPAY = true;

const CATALOG = Object.freeze({
  'classic-white': { name: 'Classic White Pullover Hoodie', price: 19.99, color: 'White' },
  'essential-black': { name: 'Essential Black Box-Fit Hoodie', price: 19.99, color: 'Black' },
  'sky-blue-heavyweight': { name: 'Sky Blue Heavyweight Hoodie', price: 21.99, color: 'Sky Blue' },
  'sand-oversized': { name: 'Sand Oversized Pullover Hoodie', price: 19.99, color: 'Sand' },
  'navy-everyday': { name: 'Navy Everyday Fleece Hoodie', price: 19.99, color: 'Navy' },
});
const ALLOWED_SIZES = new Set(['S','M','L','XL','2XL','3XL']);

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
  return typeof value === 'string' && /^FD-SHOP-[A-Z0-9-]{10,64}$/.test(value);
}

function calculateOrder(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
    throw new Error('INVALID_CART');
  }
  let cents = 0;
  const orderItems = [];
  for (const item of items) {
    const product = CATALOG[item?.id];
    const qty = Number(item?.qty);
    const size = String(item?.size || '').toUpperCase();
    const color = String(item?.color || '');
    if (!product || !Number.isInteger(qty) || qty < 1 || qty > 20 || !ALLOWED_SIZES.has(size) || color !== product.color) {
      throw new Error('INVALID_CART');
    }
    cents += Math.round(product.price * 100) * qty;
    orderItems.push({
      name: `${product.name} / ${product.color} / ${size}`,
      sku: `FD-${item.id}-${size}`.toUpperCase(),
      quantity: qty,
      unit_price: product.price.toFixed(2),
    });
  }
  if (cents < 1 || cents > 10_000_000) throw new Error('INVALID_AMOUNT');
  return { amount: (cents / 100).toFixed(2), orderItems };
}

function safeText(text) {
  if (!text) return '';
  return String(text).replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]').slice(0, 4000);
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
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  const apiKey = env.USDTONPAY_API_KEY;
  if (!apiKey) return json({ ok: false, error: 'Payment service is not configured.', debug: { key_configured: false } }, 503);
  let input;
  try { input = await request.json(); }
  catch { return json({ ok: false, error: 'Invalid request.' }, 400); }
  const orderId = input?.order_id;
  if (!validOrderId(orderId)) return json({ ok: false, error: 'Invalid order.' }, 400);
  let calculated;
  try { calculated = calculateOrder(input?.items); }
  catch { return json({ ok: false, error: 'Invalid cart.' }, 400); }
  const upstreamBody = {
    order_id: orderId,
    amount: calculated.amount,
    currency: 'USDT',
    order_note: 'Factory Drops in-house clearance order',
    items: calculated.orderItems,
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
    return json({ ok: false, error: 'USDTonPay network request failed.' }, 502);
  }
  const raw = await upstream.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}
  console.log('[FactoryDrops] USDTonPay response', JSON.stringify({ upstream_status: upstream.status, order_id: orderId, amount: calculated.amount, upstream_body: safeText(raw) }));
  if (!upstream.ok) return json({ ok: false, error: 'USDTonPay rejected the payment request.' }, 502);
  const paymentId = data?.payment_id ?? data?.id ?? data?.payment?.payment_id ?? data?.payment?.id ?? null;
  const rawCheckoutUrl = data?.payment_url ?? data?.checkout_url ?? data?.hosted_checkout_url ?? data?.url ?? data?.payment?.payment_url ?? data?.payment?.checkout_url ?? null;
  const paymentUrl = validateHostedCheckoutUrl(rawCheckoutUrl);
  if (!paymentId || !paymentUrl) return json({ ok: false, error: 'USDTonPay returned success but checkout fields were not recognized.' }, 502);
  return json({ ok: true, order_id: orderId, amount: calculated.amount, status: 'payment_pending', payment_id: String(paymentId), payment_amount: data?.payment_amount ?? data?.amount ?? null, payment_url: paymentUrl });
}

function pickWebhookSummary(data) {
  if (!data || typeof data !== 'object') return null;
  return {
    event: data.event ?? data.type ?? data.event_type ?? null,
    payment_id: data.payment_id ?? data.id ?? data.payment?.payment_id ?? data.payment?.id ?? null,
    order_id: data.order_id ?? data.merchant_order_id ?? data.payment?.order_id ?? data.payment?.merchant_order_id ?? null,
    status: data.status ?? data.payment_status ?? data.payment?.status ?? null,
    amount: data.amount ?? data.payment_amount ?? data.payment?.amount ?? data.payment?.payment_amount ?? null,
    tx_hash: data.tx_hash ?? data.transaction_hash ?? data.payment?.tx_hash ?? data.payment?.transaction_hash ?? null,
  };
}

async function handleUsdtonpayWebhook(request) {
  if (request.method === 'GET') return json({ ok: true, endpoint: '/api/webhooks/usdtonpay', mode: 'webhook-test-v1', message: 'Endpoint is online.' }, 200);
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  const signature = request.headers.get('x-usdtonpay-signature') ?? request.headers.get('X-USDTonPay-Signature');
  let raw = '';
  try { raw = await request.text(); }
  catch { return json({ ok: false, error: 'Unable to read webhook body.' }, 400); }
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  const summary = pickWebhookSummary(parsed);
  console.log('[FactoryDrops][Webhook] USDTonPay webhook received:', JSON.stringify({ received_at: new Date().toISOString(), signature_present: Boolean(signature), summary, raw_body: safeText(raw) }));
  return json({ ok: true, received: true, mode: 'webhook-test-v1', signature_present: Boolean(signature), summary }, 200);
}

const GOOGLE_TAG_HTML = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-PKF23BXWYY"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-PKF23BXWYY');
</script>`;

const HOME_STORE_HTML = `<div class="wrap">
  <div class="live-drop-head">
    <div>
      <span class="live-drop-kicker">FACTORY DROPS STORE</span>
      <h2>Hoodies — Limited Clearance Batch</h2>
    </div>
    <span class="live-drop-status">SHOP LIVE</span>
  </div>
  <div class="live-drop-card">
    <div class="live-drop-media">
      <img src="/shop/assets/products/hoodie-black.svg" alt="Factory Drops hoodie store">
    </div>
    <div class="live-drop-copy">
      <p class="live-drop-intro">While we continue onboarding qualified external sellers, Factory Drops is opening a small in-house inventory section. The current batch starts with five hoodie styles and limited clearance quantities.</p>
      <div class="live-drop-meta">
        <div><b>CATEGORY</b><span>Hoodies</span></div>
        <div><b>INVENTORY</b><span>In-house clearance</span></div>
        <div><b>STATUS</b><span>5 styles live</span></div>
        <div><b>PAYMENT</b><span>USDT</span></div>
      </div>
      <div class="live-drop-note">Limited quantities are available while stock lasts. Styles and designs can change as new clearance inventory is added.</div>
      <a class="btn orange" href="/shop/">SHOP HOODIES →</a>
    </div>
  </div>
</div>`;

function transformHtml(response, pathname) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  const uncachedResponse = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  let rewriter = new HTMLRewriter().on('head', { element(element) { element.prepend(GOOGLE_TAG_HTML, { html: true }); } });
  if (!pathname.startsWith('/shop/')) {
    rewriter = rewriter.on('.nav', { element(element) { element.append('<a href="/shop/">SHOP</a>', { html: true }); } });
  }
  if (pathname === '/' || pathname === '/index.html') {
    rewriter = rewriter.on('.live-drop-section', { element(element) { element.setInnerContent(HOME_STORE_HTML, { html: true }); } });
  }
  return rewriter.transform(uncachedResponse);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/webhooks/usdtonpay') return handleUsdtonpayWebhook(request);
    if (url.pathname === '/api/shop/create-payment') return createPayment(request, env);
    if (url.pathname === '/api/shop/debug-config') return json({ ok: true, usdtonpay_key_configured: Boolean(env.USDTONPAY_API_KEY), endpoint: USDTONPAY_ENDPOINT, debug: DEBUG_USDTONPAY });
    const assetResponse = await env.ASSETS.fetch(request);
    return transformHtml(assetResponse, url.pathname);
  },
};