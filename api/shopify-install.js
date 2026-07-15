// GET /api/shopify-install?shop=<store>
// Kicks off the one-time Shopify OAuth "install" so the portal gets a
// permanent Admin API token. Visit this URL once in your browser.

const crypto = require('crypto');

module.exports = async (req, res) => {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const scopes = process.env.SHOPIFY_SCOPES || 'write_products,read_products';

  let shop = (req.query && req.query.shop) || process.env.SHOPIFY_STORE_DOMAIN || '';
  if (!clientId) { res.status(500).send('SHOPIFY_CLIENT_ID is not set in the environment.'); return; }
  if (!shop) { res.status(400).send('Add ?shop=your-store to the URL (e.g. ?shop=zybd80-tz).'); return; }
  if (!shop.includes('.myshopify.com')) shop = `${shop}.myshopify.com`;

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const redirectUri = `https://${host}/api/shopify-callback`;
  const state = crypto.randomBytes(16).toString('hex');

  const authUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  res.setHeader('Set-Cookie', `zg_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
  res.writeHead(302, { Location: authUrl });
  res.end();
};
