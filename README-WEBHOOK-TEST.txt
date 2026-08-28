FactoryDrops — USDTonPay Webhook Test V1

Keeps:
- Demo Shop $0.50 server-side pricing
- current USDTonPay create-payment Debug V4 behavior

New endpoint:
https://factorydrops.com/api/webhooks/usdtonpay

GET:
- returns a health-check JSON

POST:
- receives the USDTonPay webhook
- reads X-USDTonPay-Signature
- reads/logs the raw request body
- extracts common fields when present
- returns HTTP 200 acknowledgement

This test version intentionally does NOT:
- verify the signature
- write to D1
- update order status
- trigger fulfillment

Test:
1. Replace root worker.js.
2. Deploy/promote the new Worker version.
3. Visit https://factorydrops.com/api/webhooks/usdtonpay
4. In USDTonPay Webhooks set Endpoint URL:
   https://factorydrops.com/api/webhooks/usdtonpay
5. Save.
6. Click Send test webhook.
7. Check Delivery status.
8. Then make one real $0.50 test payment to test the actual Order paid webhook.
