// GET /api/register-golive-webhook
// One-time setup helper: registers the products/update webhook that powers the
// "your listing is live" vendor email. Safe to hit more than once — Shopify
// just returns an "already taken" error the second time, which is fine.
// Uses the Shopify Admin token already stored in the app's env vars.

module.exports = async (req, res) => {
  try {
    const domain = process.env.SHOPIFY_STORE_DOMAIN;         // e.g. zybd80-tz.myshopify.com
    const token = process.env.SHOPIFY_ADMIN_API_TOKEN;       // shpat_ token
    const version = process.env.SHOPIFY_API_VERSION || '2026-07';
    if (!domain || !token) throw new Error('SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_API_TOKEN not set');

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const key = process.env.WEBHOOK_TOKEN || 'zg-golive';
    const callbackUrl = `https://${host}/api/shopify-product-webhook?key=${key}`;

    const query = `mutation($sub: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: PRODUCTS_UPDATE, webhookSubscription: $sub) {
        webhookSubscription { id }
        userErrors { field message }
      }
    }`;

    const r = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { sub: { callbackUrl, format: 'JSON' } } })
    });
    const data = await r.json();
    res.status(200).json({ callbackUrl, result: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
