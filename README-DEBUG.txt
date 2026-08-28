FactoryDrops USDTonPay Debug V4

1. Replace the repository-root worker.js with this worker.js.
2. Deploy the new Worker version.
3. In Cloudflare -> factorydrops -> Settings -> Variables and secrets:
   edit USDTONPAY_API_KEY and replace its value with the NEW Test API Key.
4. Promote/deploy the version containing the updated secret if Cloudflare creates a new version.
5. Test:
   https://factorydrops.com/api/demo-shop/debug-config
   It should return:
   {"ok":true,"usdtonpay_key_configured":true,...}

6. Then place a Demo Shop order again.
7. In Chrome DevTools -> Network -> create-payment -> Response,
   copy the JSON response.

During DEBUG mode, the response includes:
- debug.upstream_status
- debug.request_body
- debug.upstream_body

The API key itself is never returned.

After the interface is verified, disable DEBUG_USDTONPAY and remove debug fields.
