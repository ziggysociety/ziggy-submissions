// POST /api/shopify-product-webhook?key=YOUR_TOKEN
//
// Shopify calls this on every product update (products/update webhook). When a
// ZIGGY submission flips to ACTIVE for the first time, we email the vendor
// "your listing is live" — exactly once.
//
// Auth: we don't rely on Shopify's HMAC (which needs the raw request body).
// Instead we (a) require a shared ?key= token that only we and the webhook know,
// and (b) re-fetch the product from Shopify's Admin API before doing anything,
// so a spoofed payload can't fake product state. Sending is also de-duped via a
// custom.golive_emailed metafield, so this can't spam a vendor.

const { getProductGoLiveInfo, setGoLiveEmailed } = require('../lib/shopify');
const { sendEmail, goLiveEmailHtml } = require('../lib/email');

module.exports = async (req, res) => {
  // Always answer 200 quickly so Shopify doesn't retry-storm; we log issues.
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }

  // Optional shared-secret guard.
  const expected = process.env.WEBHOOK_TOKEN;
  if (expected && req.query && req.query.key !== expected) {
    res.status(401).send('bad token'); return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    // products/update payload includes the GraphQL id + numeric id.
    const gid = body.admin_graphql_api_id
      || (body.id ? `gid://shopify/Product/${body.id}` : null);
    if (!gid) { res.status(200).json({ ok: true, skipped: 'no product id' }); return; }

    // Source of truth: re-fetch the product.
    const info = await getProductGoLiveInfo(gid);
    if (!info) { res.status(200).json({ ok: true, skipped: 'product not found' }); return; }

    const isZiggy = (info.tags || []).some(t => String(t).toLowerCase() === 'ziggy-submission');
    const reasonsToSkip = [];
    if (info.status !== 'ACTIVE') reasonsToSkip.push('not active');
    if (!isZiggy) reasonsToSkip.push('not a ziggy submission');
    if (!info.vendorEmail) reasonsToSkip.push('no vendor email');
    if (info.goLiveEmailed) reasonsToSkip.push('already emailed');

    if (reasonsToSkip.length) {
      res.status(200).json({ ok: true, skipped: reasonsToSkip.join(', ') }); return;
    }

    // Send the go-live email, then flag the product so we never send it again.
    await sendEmail({
      to: info.vendorEmail,
      subject: `${info.title} is live on ZIGGY Society 🎉`,
      html: goLiveEmailHtml({
        brand: info.vendor,
        productTitle: info.title,
        storeUrl: process.env.STORE_PUBLIC_URL || 'https://ziggysociety.com'
      })
    });
    await setGoLiveEmailed(gid);

    res.status(200).json({ ok: true, emailed: info.vendorEmail });
  } catch (err) {
    // Log but still 200 so Shopify doesn't keep retrying a transient failure.
    console.error('go-live webhook error:', err && err.message);
    res.status(200).json({ ok: false, error: err && err.message });
  }
};
