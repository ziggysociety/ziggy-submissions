// GET /api/shopify-callback
// Shopify redirects here after you approve the install. Verifies the request,
// exchanges the code for a PERMANENT Admin API token, and shows it once so you
// can paste it into Vercel as SHOPIFY_ADMIN_API_TOKEN.

const crypto = require('crypto');

function verifyHmac(query, secret) {
  const { hmac, signature, ...rest } = query;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(',') : rest[k]}`)
    .join('&');
  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(hmac || '', 'utf8'));
  } catch {
    return false;
  }
}

module.exports = async (req, res) => {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const q = req.query || {};
  const shop = q.shop;
  const code = q.code;

  if (!clientId || !clientSecret) { res.status(500).send('Shopify client credentials are not set.'); return; }
  if (!shop || !code) { res.status(400).send('Missing shop or code.'); return; }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) { res.status(400).send('Invalid shop.'); return; }
  if (!verifyHmac(q, clientSecret)) { res.status(400).send('HMAC validation failed — request not from Shopify.'); return; }

  let data;
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    data = await tokenRes.json();
  } catch (e) {
    res.status(502).send('Token exchange request failed: ' + e.message);
    return;
  }

  if (!data || !data.access_token) {
    res.status(500).send('Token exchange failed: ' + JSON.stringify(data));
    return;
  }

  const token = data.access_token;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>ZIGGY × Shopify connected</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:48px auto;padding:0 20px;color:#1c2b1c">
  <h2 style="color:#2f4a2f">✅ ZIGGY is connected to your Shopify store</h2>
  <p>One last step: copy the token below and add it to <strong>Vercel → Project → Settings → Environment Variables</strong> as:</p>
  <p><code style="background:#eef;padding:2px 6px;border-radius:4px">SHOPIFY_ADMIN_API_TOKEN</code></p>
  <pre style="background:#f4f4f4;padding:14px;border-radius:8px;white-space:pre-wrap;word-break:break-all;font-size:14px">${token}</pre>
  <p style="font-size:14px">Scopes granted: <strong>${(data.scope || '').replace(/</g, '')}</strong></p>
  <p style="color:#666;font-size:14px">After you save the variable and redeploy, pasted product links will automatically create Shopify draft products. You can close this page — the token won't be shown again.</p>
</body></html>`);
};
