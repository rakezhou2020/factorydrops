FactoryDrops Google tag integration

Measurement ID:
G-PKF23BXWYY

What this update does:
- Keeps the current FactoryDrops payment API + webhook test Worker logic.
- Automatically injects the Google gtag.js snippet into every HTML page served by Static Assets.
- No need to edit each HTML page individually.
- Future HTML pages served by this Worker will also receive the Google tag automatically.
- API routes are not injected.

Install:
1. Replace the repository-root worker.js with this worker.js.
2. Deploy/promote the new Cloudflare Worker version.
3. Open factorydrops.com.
4. View page source and search for G-PKF23BXWYY.
5. Verify in Google Analytics Realtime after visiting the site.
