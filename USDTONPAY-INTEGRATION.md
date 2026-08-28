# FactoryDrops → USDTonPay Test API

## Architecture

Browser → `POST /api/demo-shop/create-payment` → FactoryDrops Cloudflare Worker → USDTonPay.

The browser never receives or sends the USDTonPay API key.

## Secret

Configure this in Cloudflare after the Worker-script deployment is active:

`USDTONPAY_API_KEY`

Store it as a Cloudflare **Secret**. Never commit it to GitHub.

## Request from browser to FactoryDrops

```json
{
  "order_id": "FD-DEMO-20260828193200-ABC123",
  "items": [
    {"id": "sienna", "qty": 1}
  ]
}
```

The Worker recalculates the total from its own server-side catalog.

## Request from FactoryDrops to USDTonPay

```json
{
  "order_id": "FD-DEMO-20260828193200-ABC123",
  "amount": "29.99",
  "currency": "USDT"
}
```

Authorization header:

`Authorization: Bearer <USDTONPAY_API_KEY>`

## Expected successful response fields used

- `payment_id`
- `payment_amount` (if returned)
- `payment_url`

Only a HTTPS `payment_url` on `usdtonpay.com` or a subdomain is accepted for redirect.

## Error handling

The browser gets only a simple error message. Detailed upstream failure information goes to
Cloudflare Worker logs, with credentials never returned to the browser.

## Round-one order state

`payment_pending`

No webhook handling is included in this round.
