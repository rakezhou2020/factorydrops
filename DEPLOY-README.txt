FACTORYDROPS — WORKER + STATIC ASSETS + USDTONPAY TEST API
==========================================================

WHAT THIS UPDATE DOES
---------------------
1. Keeps the existing FactoryDrops static website.
2. Adds worker.js as the Worker runtime entry point.
3. Only /api/* is forced through the Worker.
4. All ordinary HTML/CSS/images continue to be served as Static Assets.
5. Adds Demo Shop checkout integration with USDTonPay Test API.
6. API Key is read ONLY from env.USDTONPAY_API_KEY on Cloudflare.

FILES TO COPY TO THE ROOT OF YOUR GITHUB REPOSITORY
---------------------------------------------------
worker.js
wrangler.jsonc
.assetsignore
USDTONPAY-INTEGRATION.md
DEPLOY-README.txt
demo-shop/   (replace/update the existing demo-shop folder)

DO NOT PUT THE REAL API KEY IN ANY FILE.

AFTER GITHUB/CLOUDFLARE DEPLOYS THIS VERSION
--------------------------------------------
Cloudflare > Workers & Pages > factorydrops > Settings > Variables and secrets

Add a Secret:
Name:  USDTONPAY_API_KEY
Value: <your USDTonPay Test API Key>

Then redeploy if Cloudflare asks you to do so.

TEST FLOW
---------
https://factorydrops.com/demo-shop/
  -> product
  -> cart
  -> checkout
  -> Submit order
  -> POST /api/demo-shop/create-payment
  -> FactoryDrops Worker calls https://usdtonpay.com/api/v1/payments
  -> receives payment_id + payment_url
  -> browser redirects to payment_url

CURRENT UPSTREAM BODY
---------------------
{
  "order_id": "FD-DEMO-...",
  "amount": "29.99",
  "currency": "USDT"
}

IMPORTANT
---------
This round does NOT process Webhooks and does NOT write a durable server-side order database.
The browser stores the demo order as payment_pending in localStorage, and the Worker logs the
matching payment_pending order server-side. Durable D1 order persistence can be added next.
