// POST /api/submit-syncio
// Shopify-store vendors synced via Syncio. Does NOT create a Shopify draft —
// the product is imported from Syncio by Anna. Creates a ClickUp task in the
// Product Submissions list as Anna's cue to import + set the NZD price, and
// tags it 'syncio-import' so Syncio jobs can be filtered from manual ones.

const { createTask } = require('../lib/clickup');
const { getBrandEmail } = require('../lib/brands');
const { sendEmail } = require('../lib/email');

const API = 'https://api.clickup.com/api/v2';
function row(label, val) { return val ? `**${label}:** ${val}\n` : ''; }

// Best-effort tag add (auto-creates the space tag if it doesn't exist yet).
async function addTag(taskId, tag) {
  try {
    await fetch(`${API}/task/${taskId}/tag/${encodeURIComponent(tag)}`, {
      method: 'POST',
      headers: { Authorization: process.env.CLICKUP_API_TOKEN }
    });
  } catch (e) { /* non-fatal */ }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const f = body.fields || {};

    if (!f.brandName || !f.productName || !f.nzdPrice) {
      res.status(400).send('Missing required fields (brand name, product name, and NZD price).'); return;
    }

    const vendorEmail = await getBrandEmail(f.brandName);
    const priceNum = (String(f.nzdPrice).replace(',', '').match(/[\d.]+/) || [])[0] || f.nzdPrice;

    const md =
      row('Brand', f.brandName) +
      row('Vendor email', vendorEmail || '_not found — has this brand onboarded?_') +
      row('Product name', f.productName) +
      row('Product link (their store)', f.productLink) +
      row('ZIGGY price (NZD, item only)', priceNum) +
      '\n' +
      `**Source:** Syncio / Shopify store — **import this product from Syncio** and set the NZD price above. No Shopify draft was created by the form (Syncio brings the product in).\n` +
      `_Shipping is charged separately (~$10 local / ~$15 cross-border); 15% commission on product only. SKU comes through Syncio._\n` +
      `\n---\n_Submitted via the ZIGGY Syncio product form._`;

    const task = await createTask({
      name: `[Syncio] ${f.productName} — ${f.brandName}`,
      markdown: md,
      status: 'Submitted',
      assignees: [222060393] // Anna — assigning emails her on every submission
    });

    await addTag(task.id, 'syncio-import');

    try {
      await sendEmail({
        to: process.env.ADMIN_EMAIL || 'anna@ziggysociety.com',
        subject: `New Syncio product to import: ${f.productName} — ${f.brandName}`,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#2f3427;max-width:520px;margin:0 auto">
<h2 style="color:#3a4a2a">New Syncio product to import</h2>
<p><strong>${f.productName}</strong> — ${f.brandName}</p>
<p>NZD price (item only): ${priceNum}</p>
<p>Import from Syncio, then set this NZD price on the draft.</p>
<p><a href="${task.url}" style="color:#3a4a2a">Open in ClickUp</a></p>
</div>`
      });
    } catch (e) { /* non-fatal - never block a submission on the notify email */ }

    res.status(200).json({ ok: true, taskUrl: task.url });
  } catch (err) {
    res.status(500).send(err.message || 'Server error');
  }
};
